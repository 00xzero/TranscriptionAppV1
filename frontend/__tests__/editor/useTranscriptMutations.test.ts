import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useTranscriptMutations, type SaveOutcome } from '../../app/editor/[id]/hooks/useTranscriptMutations'
import { useEditorWriteQueue } from '../../app/editor/[id]/hooks/useEditorWriteQueue'
import { useLiveStore } from '../../app/editor/[id]/hooks/useLiveStore'
import type { Seg, WordsBySegment } from '../../app/editor/[id]/types'

const mockUpdateSegment = jest.fn()
const mockFetchSegmentsWithWords = jest.fn()
jest.mock('@/lib/supabase/queries', () => ({
  updateSegment: (...args: unknown[]) => mockUpdateSegment(...args),
  fetchSegmentsWithWords: (...args: unknown[]) => mockFetchSegmentsWithWords(...args),
}))
const mockToast = jest.fn()
jest.mock('@/components/ui/toaster', () => ({ toast: (...args: unknown[]) => mockToast(...args) }))

const stamp = '2026-10-13T00:00:00Z'
const seg = (id: string, text: string, revision = 0): Seg => ({
  id, transcript_id: 't1', speaker_id: null, diarization_index: null, start_ms: 0, end_ms: 1000, text,
  is_edited: false, is_filler: false, algo_version: 'test', revision, created_at: stamp, updated_at: stamp,
})
/** A segment as the reload reads it: its words in the same row. */
const withWords = (row: Seg, words: unknown[] = []) => ({ ...row, words })
const STALE = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

function setup(initial: Seg[] = [seg('seg-1', 'original text')]) {
  return renderHook(() => {
    const [segments, setSegments] = useState(initial)
    const [words, setWords] = useState<WordsBySegment>(new Map())
    const enqueue = useEditorWriteQueue()
    const segmentsStore = useLiveStore(segments, setSegments)
    const wordsStore = useLiveStore(words, setWords)
    const hook = useTranscriptMutations({ transcriptId: 't1', segments: segmentsStore, words: wordsStore, enqueue })
    return { ...hook, segments, words, enqueue, segmentsStore }
  })
}

/** Let queued writes and their promise chains run. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(10)
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

describe('useTranscriptMutations', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockUpdateSegment.mockReset().mockResolvedValue(undefined)
    mockFetchSegmentsWithWords.mockReset()
    mockToast.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('scheduleSave updates segments optimistically', () => {
    const { result } = setup()

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.segments[0].text).toBe('updated text')
  })

  it('saves the text against the revision it was edited against', async () => {
    const { result } = setup([seg('seg-1', 'original text', 3)])

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })
    await settle()

    expect(mockUpdateSegment).toHaveBeenCalledWith('seg-1', { text: 'updated text' }, 3)
  })

  it('fixes the revision at the edit, so a reshape before the save makes it stale', async () => {
    const { result } = setup()
    act(() => {
      result.current.scheduleSave('seg-1', 'typed before the split')
      // A split lands before the debounced save runs.
      result.current.segmentsStore.update((rows) => rows.map((row) => ({ ...row, revision: 1 })))
    })
    await settle()

    expect(mockUpdateSegment).toHaveBeenCalledWith('seg-1', { text: 'typed before the split' }, 0)
  })

  it('scheduleSave transitions status: saving -> saved -> idle', async () => {
    const { result } = setup()

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.saveStatus['seg-1']).toBe('saving')

    await settle()

    expect(result.current.saveStatus['seg-1']).toBe('saved')

    act(() => {
      jest.advanceTimersByTime(1200)
    })

    expect(result.current.saveStatus['seg-1']).toBe('idle')
  })

  it('scheduleSave sets error status on failure', async () => {
    mockUpdateSegment.mockRejectedValueOnce(new Error('network error'))
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.saveStatus['seg-1']).toBe('saving')

    await settle()

    expect(result.current.saveStatus['seg-1']).toBe('error')

    consoleSpy.mockRestore()
  })

  it('debounces rapid saves', async () => {
    const { result } = setup()

    act(() => {
      result.current.scheduleSave('seg-1', 'first text')
    })

    act(() => {
      result.current.scheduleSave('seg-1', 'second text')
    })

    await settle()

    expect(mockUpdateSegment).toHaveBeenCalledTimes(1)
    expect(mockUpdateSegment).toHaveBeenCalledWith('seg-1', { text: 'second text' }, 0)
  })

  it('runs saves through the shared write queue, behind work queued earlier', async () => {
    const { result } = setup()
    const order: string[] = []
    let release!: () => void
    act(() => {
      void result.current.enqueue(() => new Promise<void>((resolve) => { release = resolve }).then(() => { order.push('earlier') }))
      result.current.scheduleSave('seg-1', 'updated text')
    })
    mockUpdateSegment.mockImplementation(async () => { order.push('save') })
    await settle()
    expect(order).toEqual([])

    await act(async () => { release() })
    await settle()
    expect(order).toEqual(['earlier', 'save'])
  })

  describe('flushSave', () => {
    it('reports nothing when there is no draft', async () => {
      const { result } = setup()
      await expect(result.current.flushSave('seg-1')).resolves.toBe('nothing')
      expect(mockUpdateSegment).not.toHaveBeenCalled()
    })

    it('saves a waiting draft at once and reports it saved', async () => {
      const { result } = setup()
      act(() => {
        result.current.scheduleSave('seg-1', 'draft')
      })
      let outcome: Promise<SaveOutcome> | undefined
      act(() => {
        outcome = result.current.flushSave('seg-1')
      })
      await settle()
      await expect(outcome).resolves.toBe('saved')
      // The debounce timer was cleared: one write, not two.
      jest.advanceTimersByTime(1000)
      expect(mockUpdateSegment).toHaveBeenCalledTimes(1)
    })

    it('reports a failed write rather than assuming the draft was saved', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockUpdateSegment.mockRejectedValueOnce(new Error('network error'))
      const { result } = setup()
      act(() => {
        result.current.scheduleSave('seg-1', 'draft')
      })
      let outcome: Promise<SaveOutcome> | undefined
      act(() => {
        outcome = result.current.flushSave('seg-1')
      })
      await settle()
      await expect(outcome).resolves.toBe('failed')

      // The draft is still unsaved, so the next flush writes it again.
      let retried: Promise<SaveOutcome> | undefined
      act(() => {
        retried = result.current.flushSave('seg-1')
      })
      await settle()
      await expect(retried).resolves.toBe('saved')
      consoleSpy.mockRestore()
    })
  })

  describe('a save refused because the segment changed shape', () => {
    it('reloads, drops the stale draft, says so and reports stale', async () => {
      mockUpdateSegment.mockRejectedValueOnce(STALE)
      // Split elsewhere: seg-1 is now revision 1 with only its first half.
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('seg-1', 'first half', 1)), withWords(seg('seg-2', 'second half'))])
      const { result } = setup([seg('seg-1', 'first half second half')])
      act(() => {
        result.current.setEditingId('seg-1')
        result.current.setEditingTexts({ 'seg-1': 'first half second half, edited' })
        result.current.scheduleSave('seg-1', 'first half second half, edited')
      })
      let outcome: Promise<SaveOutcome> | undefined
      act(() => {
        outcome = result.current.flushSave('seg-1')
      })
      await settle()

      await expect(outcome).resolves.toBe('stale')
      expect(result.current.segments.map((s) => [s.id, s.text])).toEqual([['seg-1', 'first half'], ['seg-2', 'second half']])
      expect(result.current.editingTexts['seg-1']).toBe('first half')
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed' }))
      // Nothing duplicated: the stale text was never written, and nothing retries it.
      jest.advanceTimersByTime(2000)
      await settle()
      expect(mockUpdateSegment).toHaveBeenCalledTimes(1)
    })
  })

  describe('reloadSegments', () => {
    it('keeps a draft whose segment still has its revision, and drops one whose segment changed', async () => {
      // Word rows are validated, so these need real uuids.
      const C = '00000000-0000-4000-8000-00000000000c'
      const W1 = '00000000-0000-4000-8000-0000000000a1'
      mockFetchSegmentsWithWords.mockResolvedValue([
        withWords(seg('a', 'saved a')), withWords(seg('b', 'b first half', 1)),
        withWords(seg(C, 'b second half'), [{ id: W1, segment_id: C, start_ms: 0, end_ms: 100, text: 'second', punctuated_text: null, order_index: 1 }]),
      ])
      // A failing save keeps both drafts unsaved until the reload.
      mockUpdateSegment.mockImplementation(() => new Promise(() => {}))
      const { result } = setup([seg('a', 'saved a'), seg('b', 'b whole')])
      act(() => {
        result.current.scheduleSave('a', 'a draft')
        result.current.scheduleSave('b', 'b whole draft')
      })

      let reloaded: Awaited<ReturnType<typeof result.current.reloadSegments>> | undefined
      await act(async () => {
        reloaded = await result.current.reloadSegments()
      })

      expect(reloaded).toEqual({ droppedDrafts: 1 })
      expect(result.current.segments.map((s) => [s.id, s.text])).toEqual([
        ['a', 'a draft'], ['b', 'b first half'], [C, 'b second half'],
      ])
      expect(result.current.words.get(C)).toEqual([{ id: W1, text: 'second', startMs: 0, endMs: 100 }])
      // The words stay in the words map; segment rows don't carry them.
      expect(result.current.segments.some((row) => 'words' in row)).toBe(false)
      // a's draft still saves; b's was dropped with its timer.
      await settle()
      expect(mockUpdateSegment.mock.calls.map(([id]) => id)).toEqual(['a'])
    })

    it('closes the editor on a segment that is gone', async () => {
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'joined'))])
      const { result } = setup([seg('a', 'first'), seg('b', 'second')])
      act(() => {
        result.current.setEditingId('b')
        result.current.setEditingTexts({ b: 'second' })
      })
      await act(async () => {
        await result.current.reloadSegments()
      })
      expect(result.current.editingId).toBeNull()
      expect(result.current.editingTexts).toEqual({})
    })

    it('changes nothing when the database cannot be read', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchSegmentsWithWords.mockRejectedValue(new Error('offline'))
      const { result } = setup()
      let reloaded: unknown
      await act(async () => {
        reloaded = await result.current.reloadSegments()
      })
      expect(reloaded).toBeNull()
      expect(result.current.segments[0].text).toBe('original text')
      consoleSpy.mockRestore()
    })
  })

  it('opens an editor with a caret hint that lapses once editing moves on', () => {
    const { result } = setup([seg('a', 'one'), seg('b', 'two')])
    act(() => {
      result.current.openEditorAt('b', 0)
    })
    expect(result.current.editingId).toBe('b')
    expect(result.current.caretHint('b')).toBe(0)
    act(() => {
      result.current.setEditingId(null)
    })
    expect(result.current.caretHint('b')).toBeUndefined()
  })
})
