import { useEffect, useMemo, useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useTranscriptMutations } from '../../app/editor/[id]/hooks/useTranscriptMutations'
import { useEditorWriteQueue } from '../../app/editor/[id]/hooks/useEditorWriteQueue'
import { useLiveStore } from '../../app/editor/[id]/hooks/useLiveStore'
import type { Seg, WordsBySegment } from '../../app/editor/[id]/types'
import { SAVE_DEBOUNCE_MS } from '../../app/editor/[id]/utils'
import { STALE_TOAST } from '@/lib/people/errors'
import { RESEND_DELAYS_MS, createSender, type Send } from '@/lib/editor/untilAnswered'
import type { SegmentTextEdit } from '@/contracts/db'

const mockSetSegmentTexts = jest.fn()
const mockFetchSegmentsWithWords = jest.fn()
jest.mock('@/lib/supabase/queries', () => ({
  setSegmentTexts: (...args: unknown[]) => mockSetSegmentTexts(...args),
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
/** The rows the database answers a text write with. */
const written = (edits: readonly SegmentTextEdit[]) => edits.map((e) => seg(e.segment_id, e.text, e.expected_revision))
const CHANGED = { code: 'SP002', message: 'segment text changed since it was read' }
const LOST = { code: '', message: 'TypeError: Failed to fetch' }

/** Sends once; a test that needs resending passes the real sender. */
const sendOnce: Send = (call) => call()

function setup(initial: Seg[] = [seg('seg-1', 'original text')], { send = sendOnce, resend = false, onExternalChange = jest.fn() } = {}) {
  const hook = renderHook(() => {
    const [segments, setSegments] = useState(initial)
    const [words, setWords] = useState<WordsBySegment>(new Map())
    const enqueue = useEditorWriteQueue()
    const segmentsStore = useLiveStore(segments, setSegments)
    const wordsStore = useLiveStore(words, setWords)
    const realSend = useRealSender()
    const hook = useTranscriptMutations({
      transcriptId: 't1', segments: segmentsStore, words: wordsStore, enqueue, send: resend ? realSend : send, onExternalChange,
    })
    return { ...hook, segments, words, enqueue, segmentsStore }
  })
  return { ...hook, onExternalChange }
}

/** A real sender, open for the test: lost answers are sent again. */
function useRealSender(): Send {
  const sender = useMemo(() => createSender(() => {}), [])
  useEffect(() => () => sender.close(), [sender])
  return sender.send
}

/** Let queued writes and their promise chains run. */
async function settle(ms = 10) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

describe('useTranscriptMutations', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockSetSegmentTexts.mockReset().mockImplementation(async (edits: SegmentTextEdit[]) => written(edits))
    mockFetchSegmentsWithWords.mockReset()
    mockToast.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('scheduleSave updates segments optimistically', () => {
    const { result } = setup()
    act(() => { result.current.scheduleSave('seg-1', 'updated text') })
    expect(result.current.segments[0].text).toBe('updated text')
  })

  it('saves the text against the revision it was edited against and the text it replaces', async () => {
    const { result } = setup([seg('seg-1', 'original text', 3)])
    act(() => { result.current.scheduleSave('seg-1', 'updated text') })
    await settle()
    expect(mockSetSegmentTexts).toHaveBeenCalledWith([
      { segment_id: 'seg-1', expected_revision: 3, expected_text: 'original text', text: 'updated text' },
    ])
  })

  it('expects the last saved text, not the one typed since', async () => {
    const { result } = setup()
    act(() => { result.current.scheduleSave('seg-1', 'first') })
    await settle()
    act(() => { result.current.scheduleSave('seg-1', 'second') })
    await settle()
    expect(mockSetSegmentTexts).toHaveBeenLastCalledWith([
      { segment_id: 'seg-1', expected_revision: 0, expected_text: 'first', text: 'second' },
    ])
  })

  it('fixes the revision at the edit, so a reshape before the save is refused', async () => {
    const { result } = setup()
    act(() => {
      result.current.scheduleSave('seg-1', 'typed before the split')
      // A split lands before the debounced save runs.
      result.current.segmentsStore.update((rows) => rows.map((row) => ({ ...row, revision: 1 })))
    })
    await settle()
    expect(mockSetSegmentTexts).toHaveBeenCalledWith([expect.objectContaining({ expected_revision: 0 })])
  })

  it('scheduleSave transitions status: saving -> saved -> idle', async () => {
    const { result } = setup()
    act(() => { result.current.scheduleSave('seg-1', 'updated text') })
    expect(result.current.saveStatus['seg-1']).toBe('saving')
    await settle()
    expect(result.current.saveStatus['seg-1']).toBe('saved')
    act(() => { jest.advanceTimersByTime(1200) })
    expect(result.current.saveStatus['seg-1']).toBe('idle')
  })

  it('scheduleSave sets error status when the database refuses for another reason', async () => {
    mockSetSegmentTexts.mockRejectedValueOnce({ code: 'XX000', message: 'boom' })
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()
    act(() => { result.current.scheduleSave('seg-1', 'updated text') })
    await settle()
    expect(result.current.saveStatus['seg-1']).toBe('error')
    consoleSpy.mockRestore()
  })

  it('debounces rapid saves', async () => {
    const { result } = setup()
    act(() => { result.current.scheduleSave('seg-1', 'first text') })
    act(() => { result.current.scheduleSave('seg-1', 'second text') })
    await settle()
    expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
    expect(mockSetSegmentTexts).toHaveBeenCalledWith([expect.objectContaining({ text: 'second text' })])
  })

  it('runs saves through the shared write queue, behind work queued earlier', async () => {
    const { result } = setup()
    const order: string[] = []
    let release!: () => void
    act(() => {
      void result.current.enqueue(() => new Promise<void>((resolve) => { release = resolve }).then(() => { order.push('earlier') }))
      result.current.scheduleSave('seg-1', 'updated text')
    })
    mockSetSegmentTexts.mockImplementation(async (edits: SegmentTextEdit[]) => { order.push('save'); return written(edits) })
    await settle()
    expect(order).toEqual([])
    await act(async () => { release() })
    await settle()
    expect(order).toEqual(['earlier', 'save'])
  })

  // A Replace All schedules many saves at once; they go in one write, all or nothing.
  it('saves drafts that come due together in one write', async () => {
    let answer!: () => void
    mockSetSegmentTexts.mockImplementation((edits: SegmentTextEdit[]) => new Promise((resolve) => { answer = () => resolve(written(edits)) }))
    const { result } = setup([seg('a', 'a'), seg('b', 'b'), seg('c', 'c')])
    act(() => { for (const id of ['a', 'b', 'c']) result.current.scheduleSave(id, `${id} replaced`) })
    await settle()
    expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
    expect(mockSetSegmentTexts.mock.calls[0][0].map((e: SegmentTextEdit) => e.segment_id)).toEqual(['a', 'b', 'c'])
    let later = false
    act(() => { void result.current.enqueue(async () => { later = true }) })
    await settle()
    expect(later).toBe(false)
    await act(async () => answer())
    await settle()
    expect(later).toBe(true)
  })

  it('takes every waiting draft along when one comes due, even one whose own wait has not run out', async () => {
    const { result } = setup([seg('a', 'a'), seg('b', 'b')])
    const stagger = SAVE_DEBOUNCE_MS / 2
    act(() => { result.current.scheduleSave('a', 'a edited') })
    await act(async () => { jest.advanceTimersByTime(stagger) })
    act(() => { result.current.scheduleSave('b', 'b edited') })
    await settle(SAVE_DEBOUNCE_MS - stagger)
    expect(mockSetSegmentTexts.mock.calls[0][0].map((e: SegmentTextEdit) => e.segment_id)).toEqual(['a', 'b'])
    // b's timer was cleared with it: nothing is written twice.
    await settle(SAVE_DEBOUNCE_MS)
    expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
  })

  it('resends a save whose answer was lost, the same request, and settles it once', async () => {
    let attempts = 0
    mockSetSegmentTexts.mockImplementation(async (edits: SegmentTextEdit[]) => {
      attempts++
      if (attempts === 1) throw LOST
      return written(edits)
    })
    const onExternalChange = jest.fn()
    const { result } = renderHook(() => {
      const [segments, setSegments] = useState([seg('seg-1', 'original text')])
      const [words, setWords] = useState<WordsBySegment>(new Map())
      const enqueue = useEditorWriteQueue()
      const send = useRealSender()
      return useTranscriptMutations({
        transcriptId: 't1', segments: useLiveStore(segments, setSegments), words: useLiveStore(words, setWords),
        enqueue, send, onExternalChange,
      })
    })
    act(() => { result.current.scheduleSave('seg-1', 'typed') })
    await settle(SAVE_DEBOUNCE_MS)
    expect(attempts).toBe(1)
    await settle(RESEND_DELAYS_MS[0])
    expect(attempts).toBe(2)
    // Byte for byte the first request: it never re-reads the drafts.
    expect(mockSetSegmentTexts.mock.calls[1][0]).toBe(mockSetSegmentTexts.mock.calls[0][0])
    expect(result.current.saveStatus['seg-1']).toBe('saved')
    expect(onExternalChange).not.toHaveBeenCalled()
  })

  describe('a save refused because something changed elsewhere', () => {
    it('reloads once, and drops the overtaken draft with its text to copy', async () => {
      mockSetSegmentTexts.mockRejectedValue(CHANGED)
      // Split elsewhere: seg-1 is now revision 1 with only its first half.
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('seg-1', 'first half', 1)), withWords(seg('seg-2', 'second half'))])
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const { result, onExternalChange } = setup([seg('seg-1', 'first half second half')])
      act(() => {
        result.current.setEditingId('seg-1')
        result.current.setEditingTexts({ 'seg-1': 'first half second half, edited' })
        result.current.scheduleSave('seg-1', 'first half second half, edited')
      })
      await settle(SAVE_DEBOUNCE_MS)

      expect(mockFetchSegmentsWithWords).toHaveBeenCalledTimes(1)
      expect(result.current.segments.map((s) => [s.id, s.text])).toEqual([['seg-1', 'first half'], ['seg-2', 'second half']])
      expect(result.current.editingTexts['seg-1']).toBe('first half')
      expect(mockToast).toHaveBeenCalledTimes(1)
      const shown = mockToast.mock.calls[0][0]
      expect(shown).toMatchObject({
        title: 'Changed in another tab — refreshed', description: "Your last edit to a segment that changed wasn't saved.",
        action: { label: 'Copy text' },
      })
      shown.action.onClick()
      expect(writeText).toHaveBeenCalledWith('first half second half, edited')
      // The history is cleared quietly: the toast above already says what happened.
      expect(onExternalChange).toHaveBeenCalledWith(true)
      // Nothing duplicated: the overtaken text is never written again.
      await settle(2000)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
    })

    it('writes again the drafts the reload kept from a batch one conflict refused', async () => {
      mockSetSegmentTexts.mockRejectedValueOnce(CHANGED)
      // a was edited elsewhere; b is as this editor last saw it.
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'a, edited elsewhere')), withWords(seg('b', 'b'))])
      const { result } = setup([seg('a', 'a'), seg('b', 'b')])
      act(() => { for (const id of ['a', 'b']) result.current.scheduleSave(id, `${id} typed`) })
      await settle(SAVE_DEBOUNCE_MS)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(2)
      expect(mockSetSegmentTexts).toHaveBeenLastCalledWith([
        { segment_id: 'b', expected_revision: 0, expected_text: 'b', text: 'b typed' },
      ])
      expect(result.current.saveStatus['b']).toBe('saved')
      expect(result.current.segments.map((s) => [s.id, s.text])).toEqual([['a', 'a, edited elsewhere'], ['b', 'b typed']])
    })

    it('stops, and says the drafts are not saved, when the database refuses the reload', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockSetSegmentTexts.mockRejectedValue(CHANGED)
      mockFetchSegmentsWithWords.mockRejectedValue({ code: '42501', message: 'denied' })
      const { result } = setup([seg('a', 'a'), seg('b', 'b')])
      act(() => { for (const id of ['a', 'b']) result.current.scheduleSave(id, `${id} typed`) })
      await settle(SAVE_DEBOUNCE_MS)
      await settle(SAVE_DEBOUNCE_MS * 4)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
      expect(result.current.saveStatus).toMatchObject({ a: 'error', b: 'error' })
      consoleSpy.mockRestore()
    })

    // A save commits but its answer is lost; typing goes on; the resend is then refused for another reason.
    const lostThenRefused = () => {
      let attempts = 0
      mockSetSegmentTexts.mockImplementation(async (edits: SegmentTextEdit[]) => {
        attempts++
        if (attempts === 1) throw LOST
        if (attempts === 2) throw { code: '57014', message: 'canceling statement due to statement timeout' }
        return written(edits)
      })
    }

    it('keeps typing done on top of a save whose outcome was unknown, when the database holds that save', async () => {
      lostThenRefused()
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('seg-1', 'first'))])
      const { result } = setup(undefined, { resend: true })
      act(() => { result.current.scheduleSave('seg-1', 'first') })
      await settle(SAVE_DEBOUNCE_MS)
      act(() => { result.current.scheduleSave('seg-1', 'first, then more') })
      await settle(RESEND_DELAYS_MS[0])
      await settle(SAVE_DEBOUNCE_MS)
      expect(mockToast).not.toHaveBeenCalled()
      expect(mockSetSegmentTexts).toHaveBeenLastCalledWith([
        { segment_id: 'seg-1', expected_revision: 0, expected_text: 'first', text: 'first, then more' },
      ])
      expect(result.current.saveStatus['seg-1']).toBe('saved')
    })

    it('keeps typing done on top of an undo whose outcome was unknown, when the database holds the undo', async () => {
      lostThenRefused()
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'one'))])
      const { result } = setup([seg('a', 'one two')], { resend: true })
      act(() => {
        // The text being undone was saved earlier.
        result.current.adopt([seg('a', 'one two')])
        void result.current.enqueue(async () => {
          // As the history does: a refused undo reads the database again.
          await result.current.applyTexts([{ segId: 'a', before: 'one', after: 'one two' }], 'undo', () => {}).catch(() => result.current.reloadSegments())
        })
      })
      await settle()
      // Typed into the text the undo showed, while its write waits on an answer.
      act(() => { result.current.scheduleSave('a', 'one three') })
      await settle(RESEND_DELAYS_MS[0])
      await settle(SAVE_DEBOUNCE_MS)
      expect(mockToast).not.toHaveBeenCalled()
      expect(result.current.segments[0].text).toBe('one three')
      expect(mockSetSegmentTexts).toHaveBeenLastCalledWith([
        { segment_id: 'a', expected_revision: 0, expected_text: 'one', text: 'one three' },
      ])
    })

    it('settles quietly when the database already holds the draft (the answer was lost, then refused)', async () => {
      // The first attempt committed; the resend then found the text changed... to the draft itself.
      mockSetSegmentTexts.mockRejectedValue(CHANGED)
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('seg-1', 'typed'))])
      const { result, onExternalChange } = setup()
      act(() => { result.current.scheduleSave('seg-1', 'typed') })
      await settle(SAVE_DEBOUNCE_MS)
      expect(result.current.saveStatus['seg-1']).toBe('saved')
      expect(mockToast).not.toHaveBeenCalled()
      expect(onExternalChange).not.toHaveBeenCalled()
    })
  })

  describe('writeDrafts', () => {
    it('writes nothing when there is no draft', async () => {
      const { result } = setup()
      await expect(result.current.writeDrafts(['seg-1'])).resolves.toBeUndefined()
      expect(mockSetSegmentTexts).not.toHaveBeenCalled()
    })

    it('writes a waiting draft at once and clears its timer', async () => {
      const { result } = setup()
      act(() => { result.current.scheduleSave('seg-1', 'draft') })
      await act(async () => { await result.current.writeDrafts(['seg-1']) })
      expect(result.current.saveStatus['seg-1']).toBe('saved')
      await settle(SAVE_DEBOUNCE_MS)
      // The debounced save found nothing left to write.
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
    })

    it('reports a refused write rather than assuming the draft was saved, and writes it next time', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockSetSegmentTexts.mockRejectedValueOnce({ code: 'XX000', message: 'boom' })
      const { result } = setup()
      act(() => { result.current.scheduleSave('seg-1', 'draft') })
      await act(async () => { await expect(result.current.writeDrafts(['seg-1'])).rejects.toMatchObject({ code: 'XX000' }) })
      expect(result.current.saveStatus['seg-1']).toBe('error')
      await act(async () => { await result.current.writeDrafts(['seg-1']) })
      expect(result.current.saveStatus['seg-1']).toBe('saved')
      consoleSpy.mockRestore()
    })
  })

  describe('applyTexts', () => {
    it('writes waiting drafts first, then shows and writes the step, expecting the text it replaces', async () => {
      const { result } = setup([seg('a', 'one')])
      act(() => { result.current.scheduleSave('a', 'one two') })
      const applied = jest.fn()
      await act(async () => {
        await result.current.applyTexts([{ segId: 'a', before: 'one', after: 'one two' }], 'undo', applied)
      })
      expect(mockSetSegmentTexts.mock.calls.map(([edits]) => edits)).toEqual([
        [{ segment_id: 'a', expected_revision: 0, expected_text: 'one', text: 'one two' }],
        [{ segment_id: 'a', expected_revision: 0, expected_text: 'one two', text: 'one' }],
      ])
      expect(applied).toHaveBeenCalledTimes(1)
      expect(result.current.segments[0].text).toBe('one')
    })

    it('shows the change before the database answers', async () => {
      let answer!: () => void
      mockSetSegmentTexts.mockImplementation((edits: SegmentTextEdit[]) => new Promise((resolve) => { answer = () => resolve(written(edits)) }))
      const { result } = setup([seg('a', 'one two')])
      const applied = jest.fn()
      let done: Promise<void> | undefined
      act(() => { done = result.current.applyTexts([{ segId: 'a', before: 'one', after: 'one two' }], 'undo', applied) })
      await settle()
      expect(applied).toHaveBeenCalled()
      expect(result.current.segments[0].text).toBe('one')
      await act(async () => { answer(); await done })
    })

    it('is refused when the segment no longer shows what the step left', async () => {
      const { result } = setup([seg('a', 'changed meanwhile')])
      await expect(result.current.applyTexts([{ segId: 'a', before: 'one', after: 'one two' }], 'undo', jest.fn()))
        .rejects.toMatchObject({ code: 'SP002' })
      expect(mockSetSegmentTexts).not.toHaveBeenCalled()
    })

    it('puts back only segments nothing was typed over when a write fails', async () => {
      let fail!: () => void
      mockSetSegmentTexts.mockImplementation(() => new Promise((_, reject) => { fail = () => reject({ code: 'XX000' }) }))
      const { result } = setup([seg('a', 'a after'), seg('b', 'b after')])
      let done: Promise<void> | undefined
      act(() => {
        done = result.current.applyTexts([
          { segId: 'a', before: 'a before', after: 'a after' },
          { segId: 'b', before: 'b before', after: 'b after' },
        ], 'undo', jest.fn())
      })
      await settle()
      // b is typed into after the undo showed.
      act(() => { result.current.segmentsStore.update((rows) => rows.map((r) => r.id === 'b' ? { ...r, text: 'b before, typed' } : r)) })
      await act(async () => { fail(); await done!.catch(() => undefined) })
      expect(result.current.segments.map((s) => s.text)).toEqual(['a after', 'b before, typed'])
    })

    it('leaves a write refused as changed elsewhere for the reload to settle', async () => {
      mockSetSegmentTexts.mockRejectedValue(CHANGED)
      const { result } = setup([seg('a', 'a after')])
      await act(async () => {
        await result.current.applyTexts([{ segId: 'a', before: 'a before', after: 'a after' }], 'undo', jest.fn()).catch(() => undefined)
      })
      expect(result.current.segments[0].text).toBe('a before')
    })
  })

  describe('reloadSegments', () => {
    it('keeps a draft still written against what the database holds, and drops one overtaken', async () => {
      // Word rows are validated, so these need real uuids.
      const C = '00000000-0000-4000-8000-00000000000c'
      const W1 = '00000000-0000-4000-8000-0000000000a1'
      mockFetchSegmentsWithWords.mockResolvedValue([
        withWords(seg('a', 'saved a')), withWords(seg('b', 'b first half', 1)),
        withWords(seg(C, 'b second half'), [{ id: W1, segment_id: C, start_ms: 0, end_ms: 100, text: 'second', punctuated_text: null, order_index: 1 }]),
      ])
      // A save that never answers keeps both drafts unsaved until the reload.
      mockSetSegmentTexts.mockImplementation(() => new Promise(() => {}))
      const { result, onExternalChange } = setup([seg('a', 'saved a'), seg('b', 'b whole')])
      act(() => {
        result.current.scheduleSave('a', 'a draft')
        result.current.scheduleSave('b', 'b whole draft')
      })

      let reloaded: boolean | undefined
      await act(async () => { reloaded = await result.current.reloadSegments() })

      expect(reloaded).toBe(true)
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Changed in another tab — refreshed', description: "Your last edit to a segment that changed wasn't saved.",
      }))
      expect(onExternalChange).toHaveBeenCalledWith(true)
      expect(result.current.segments.map((s) => [s.id, s.text])).toEqual([
        ['a', 'a draft'], ['b', 'b first half'], [C, 'b second half'],
      ])
      expect(result.current.words.get(C)).toEqual([{ id: W1, text: 'second', startMs: 0, endMs: 100 }])
      expect(result.current.segments.some((row) => 'words' in row)).toBe(false)
      // a's draft still saves; b's was dropped with its timer.
      await settle(SAVE_DEBOUNCE_MS)
      expect(mockSetSegmentTexts.mock.calls.map(([edits]) => edits.map((e: SegmentTextEdit) => e.segment_id))).toEqual([['a']])
    })

    it('says nothing changed elsewhere when the database holds what was shown', async () => {
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'one')), withWords(seg('b', 'two'))])
      const { result, onExternalChange } = setup([seg('a', 'one'), seg('b', 'two')])
      await act(async () => { await result.current.reloadSegments() })
      expect(onExternalChange).not.toHaveBeenCalled()
    })

    it('reports text another tab changed', async () => {
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'one, edited elsewhere'))])
      const { result, onExternalChange } = setup([seg('a', 'one')])
      await act(async () => { await result.current.reloadSegments() })
      expect(onExternalChange).toHaveBeenCalledWith(false)
      expect(mockToast).not.toHaveBeenCalled()
    })

    it('closes the editor on a segment that is gone', async () => {
      mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('a', 'joined'))])
      const { result } = setup([seg('a', 'first'), seg('b', 'second')])
      act(() => {
        result.current.setEditingId('b')
        result.current.setEditingTexts({ b: 'second' })
      })
      await act(async () => { await result.current.reloadSegments() })
      expect(result.current.editingId).toBeNull()
      expect(result.current.editingTexts).toEqual({})
    })

    it('changes nothing when the database refuses the read', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockFetchSegmentsWithWords.mockRejectedValue({ code: '42501', message: 'denied' })
      const { result } = setup()
      let reloaded: unknown
      await act(async () => { reloaded = await result.current.reloadSegments() })
      expect(reloaded).toBe(false)
      expect(result.current.segments[0].text).toBe('original text')
      expect(mockToast).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  it('opens an editor with a caret hint that lapses once editing moves on', () => {
    const { result } = setup([seg('a', 'one'), seg('b', 'two')])
    act(() => { result.current.openEditorAt('b', { start: 1, end: 3 }) })
    expect(result.current.editingId).toBe('b')
    expect(result.current.caretHint('b')).toMatchObject({ start: 1, end: 3 })
    act(() => { result.current.setEditingId(null) })
    expect(result.current.caretHint('b')).toBeUndefined()
  })

  it('logs a bug in the reload after a refused save, and says the refresh failed', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockSetSegmentTexts.mockRejectedValue(CHANGED)
    mockFetchSegmentsWithWords.mockResolvedValue([withWords(seg('seg-1', 'changed elsewhere text'))])
    const onExternalChange = jest.fn(() => { throw new Error('bug') })
    const { result } = setup(undefined, { onExternalChange })
    act(() => { result.current.scheduleSave('seg-1', 'typed') })
    await settle(SAVE_DEBOUNCE_MS)
    expect(onExternalChange).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('failed to reload segments'), expect.any(Error))
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: STALE_TOAST }))
    error.mockRestore()
  })

  describe('saving before leaving', () => {
    it('saves a waiting draft now, without waiting for its debounce', async () => {
      const { result } = setup()
      act(() => { result.current.scheduleSave('seg-1', 'typed') })
      expect(result.current.hasDrafts()).toBe(true)
      act(() => { result.current.saveNow() })
      await settle(1)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
      expect(result.current.hasDrafts()).toBe(false)
      await settle(SAVE_DEBOUNCE_MS)
      expect(mockSetSegmentTexts).toHaveBeenCalledTimes(1)
    })

    it('builds the writes for the waiting drafts as a save would, with their text', () => {
      const { result } = setup()
      act(() => { result.current.scheduleSave('seg-1', 'typed') })
      expect(result.current.draftEdits()).toEqual({
        edits: [{ segment_id: 'seg-1', expected_revision: 0, expected_text: 'original text', text: 'typed' }],
        texts: ['typed'],
      })
    })
  })
})
