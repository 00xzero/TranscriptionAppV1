import { useEffect, useMemo, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useEditorWriteQueue } from '@/app/editor/[id]/hooks/useEditorWriteQueue'
import { useLiveStore } from '@/app/editor/[id]/hooks/useLiveStore'
import { useSegmentSplit } from '@/app/editor/[id]/hooks/useSegmentSplit'
import { useTranscriptMutations } from '@/app/editor/[id]/hooks/useTranscriptMutations'
import { useSegmentHolds } from '@/app/editor/[id]/hooks/useSegmentHolds'
import { useEditorHistory } from '@/app/editor/[id]/hooks/useEditorHistory'
import { compareSegments } from '@/app/editor/[id]/hooks/segmentSplit'
import { groupSourceWords } from '@/app/editor/[id]/utils'
import type { Seg, WordsBySegment } from '@/app/editor/[id]/types'
import { RESEND_DELAYS_MS, createSender, type Send } from '@/lib/editor/untilAnswered'
import type { RejoinSegmentsRequest, SplitSegmentRequest } from '@/lib/supabase/queries'
import type { SegmentTextEdit } from '@/contracts/db'

jest.mock('@/lib/supabase/queries', () => ({
  setSegmentTexts: jest.fn(),
  fetchSegmentsWithWords: jest.fn(),
  splitSegment: jest.fn(),
  rejoinSegments: jest.fn(),
}))
jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))
const queries = jest.requireMock('@/lib/supabase/queries')
const { toast } = jest.requireMock('@/components/ui/toaster')

// Word rows are validated as uuids when the editor reloads them.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = uuid(0xa0)
const BEFORE = uuid(0xb0)
const W = [uuid(1), uuid(2), uuid(3), uuid(4)]
const TEXT = 'One two. Three four.'
const CARET = TEXT.indexOf('Three')
const SPEAKER = uuid(0x80)

const stamp = '2026-10-13T00:00:00Z'
const seg = (id: string, start_ms: number, end_ms: number, text: string): Seg => ({
  id, transcript_id: uuid(0x70), speaker_id: SPEAKER, diarization_index: 0, start_ms, end_ms, text,
  is_edited: false, is_filler: false, algo_version: 'test', revision: 0, created_at: stamp, updated_at: stamp,
})
type WordRow = { id: string; segment_id: string; start_ms: number; end_ms: number; text: string; punctuated_text: null; order_index: number }
const wordRow = (id: string, segment_id: string, start_ms: number, text: string, order_index: number): WordRow =>
  ({ id, segment_id, start_ms, end_ms: start_ms + 150, text, punctuated_text: null, order_index })

const LOST = { code: '', message: 'TypeError: Failed to fetch' }
const refusal = (code: string) => ({ code, message: code })

/** The database the editor talks to: the guarded functions' rules, in memory. */
function createDb() {
  const db = {
    segments: [seg(BEFORE, 0, 900, 'Before.'), seg(A, 1000, 2000, TEXT)],
    words: [
      wordRow(uuid(0x99), BEFORE, 0, 'Before.', 0),
      wordRow(W[0], A, 1000, 'One', 0), wordRow(W[1], A, 1200, 'two.', 1),
      wordRow(W[2], A, 1500, 'Three', 2), wordRow(W[3], A, 1800, 'four.', 3),
    ],
  }
  const find = (id: string) => db.segments.find((s) => s.id === id)
  const wordsOf = (id: string) => db.words.filter((w) => w.segment_id === id)
    .sort((a, b) => a.order_index - b.order_index || (a.id < b.id ? -1 : 1))
  return {
    db,
    find,
    setTexts(edits: readonly SegmentTextEdit[]): Seg[] {
      // All or nothing; a segment already holding the new text passes.
      for (const e of edits) {
        const s = find(e.segment_id)
        if (!s || s.revision !== e.expected_revision || (s.text !== e.expected_text && s.text !== e.text)) throw refusal('SP002')
      }
      return edits.map((e) => { const s = find(e.segment_id)!; s.text = e.text; s.is_edited = true; return { ...s } })
    },
    split(req: SplitSegmentRequest): [Seg, Seg] {
      const s = find(req.segmentId)
      if (!s) throw refusal('SP001')
      const made = find(req.newSegmentId)
      if (made) {
        // A replay counts only while both halves hold what the split wrote.
        if (made.revision === 0 && s.revision === req.expectedRevision + 1 &&
            s.text === req.firstText && made.text === req.secondText &&
            s.speaker_id === req.expectedSpeakerId && made.speaker_id === req.expectedSpeakerId &&
            wordsOf(made.id).some((w) => w.id === req.splitWordId)) return [{ ...s }, { ...made }]
        throw refusal('SP002')
      }
      if (s.revision !== req.expectedRevision || s.text !== req.expectedText || s.speaker_id !== req.expectedSpeakerId) throw refusal('SP002')
      const ws = wordsOf(s.id)
      const k = ws.findIndex((w) => w.id === req.splitWordId)
      if (k <= 0) throw refusal('SP003')
      const moved = ws.slice(k)
      const next: Seg = { ...s, id: req.newSegmentId, text: req.secondText, revision: 0, is_edited: true,
        start_ms: Math.min(...moved.map((w) => w.start_ms)) }
      moved.forEach((w) => { w.segment_id = next.id })
      Object.assign(s, { text: req.firstText, revision: s.revision + 1, is_edited: true,
        end_ms: Math.max(...ws.slice(0, k).map((w) => w.end_ms)) })
      db.segments.push(next)
      return [{ ...s }, { ...next }]
    },
    rejoin(req: RejoinSegmentsRequest): Seg {
      const s = find(req.segmentId)
      if (!s) throw refusal('SP001')
      const n = find(req.nextSegmentId)
      if (!n) {
        if (s.revision === req.expectedRevision + 1 && s.text === req.text && s.speaker_id === req.expectedSpeakerId &&
            db.words.some((w) => w.id === req.nextFirstWordId && w.segment_id === s.id)) return { ...s }
        throw refusal('SP002')
      }
      if (s.revision !== req.expectedRevision || n.revision !== req.expectedNextRevision || s.text !== req.expectedText ||
          n.text !== req.expectedNextText || s.speaker_id !== req.expectedSpeakerId || n.speaker_id !== req.expectedNextSpeakerId) {
        throw refusal('SP002')
      }
      wordsOf(n.id).forEach((w) => { w.segment_id = s.id })
      db.segments = db.segments.filter((x) => x !== n)
      Object.assign(s, { text: req.text, revision: s.revision + 1, end_ms: Math.max(s.end_ms, n.end_ms) })
      return { ...s }
    },
  }
}

let fake: ReturnType<typeof createDb>
/** Every call the editor made to the database, in order. */
let calls: string[]

const sendOnce: Send = (call) => call()

function setup({ resend = false } = {}) {
  const initial = fake.db.segments.map((s) => ({ ...s }))
  const initialWords: WordsBySegment = groupSourceWords(fake.db.words.map((w) => ({ ...w })))
  return renderHook(() => {
    const [segments, setSegments] = useState(initial)
    const [words, setWords] = useState<WordsBySegment>(initialWords)
    const enqueue = useEditorWriteQueue()
    const segmentsStore = useLiveStore(segments, setSegments)
    const wordsStore = useLiveStore(words, setWords)
    const holds = useSegmentHolds()
    const sender = useMemo(() => createSender(() => {}), [])
    useEffect(() => () => sender.close(), [sender])
    const send = resend ? sender.send : sendOnce
    const editing = useTranscriptMutations({ transcriptId: uuid(0x70), segments: segmentsStore, words: wordsStore, enqueue, send })
    const history = useEditorHistory({
      enqueue, holds, reveal: () => {}, refresh: editing.reloadSegments, isReconnecting: () => false, reconnecting: false,
    })
    const splitting = useSegmentSplit({ segments: segmentsStore, words: wordsStore, history, editing, send, holds })
    return { editing, splitting, segments, words, history, enqueue, holds }
  })
}

type Hook = ReturnType<typeof setup>['result']
const ids = (result: Hook) => result.current.segments.map((s) => s.id)
const texts = (result: Hook) => result.current.segments.map((s) => s.text)
const wordIds = (result: Hook, id: string) => (result.current.words.get(id) ?? []).map((w) => w.id)
const splitRequests = (): SplitSegmentRequest[] => queries.splitSegment.mock.calls.map(([req]: [SplitSegmentRequest]) => req)

/** Split A at the caret, from its open editor, as Enter does. */
function split(result: Hook, text = TEXT, caret = CARET) {
  act(() => result.current.editing.setEditingId(A))
  act(() => result.current.splitting.split(A, text, caret))
}

beforeEach(() => {
  jest.clearAllMocks()
  fake = createDb()
  calls = []
  queries.setSegmentTexts.mockImplementation(async (edits: SegmentTextEdit[]) => {
    calls.push(`save ${edits.map((e) => (e.segment_id === A ? 'A' : e.segment_id)).join(',')}`)
    return fake.setTexts(edits)
  })
  queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => {
    calls.push('split')
    return fake.split(req)
  })
  queries.rejoinSegments.mockImplementation(async (req: RejoinSegmentsRequest) => {
    calls.push('rejoin')
    return fake.rejoin(req)
  })
  queries.fetchSegmentsWithWords.mockImplementation(async () => {
    calls.push('reload')
    return [...fake.db.segments].sort(compareSegments)
      .map((s) => ({ ...s, words: fake.db.words.filter((w) => w.segment_id === s.id).map((w) => ({ ...w })) }))
  })
})

it('waits for the database, then shows both halves and words, with no Undo toast', async () => {
  const { result } = setup()
  split(result)
  expect(result.current.holds.busy.get(A)).toBe('splitting')
  await waitFor(() => expect(ids(result)).toHaveLength(3))
  expect(texts(result)).toEqual(['Before.', 'One two.', 'Three four.'])
  const newId = ids(result)[2]
  expect(wordIds(result, A)).toEqual(W.slice(0, 2))
  expect(wordIds(result, newId)).toEqual(W.slice(2))
  expect(result.current.history.undoLabel).toBe('split')
  expect(toast).not.toHaveBeenCalled()
  // Editing follows to the new half, from the half it was split from.
  expect(result.current.editing.editingId).toBe(newId)
})

it('sends the cut the caret makes, expecting the revision, text and speaker it splits', async () => {
  const { result } = setup()
  split(result)
  await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(1))
  expect(splitRequests()[0]).toMatchObject({
    segmentId: A, expectedRevision: 0, splitWordId: W[2], firstText: 'One two.', secondText: 'Three four.',
    expectedText: TEXT, expectedSpeakerId: SPEAKER,
  })
})

it('does nothing where there is no split', () => {
  const { result } = setup()
  split(result, TEXT, 0)
  split(result, TEXT, TEXT.length)
  expect(queries.splitSegment).not.toHaveBeenCalled()
  expect(result.current.history.canUndo).toBe(false)
})

it('turns a second split away while the first is pending', async () => {
  let finish!: () => void
  queries.splitSegment.mockImplementationOnce((request: SplitSegmentRequest) => new Promise((resolve) => { finish = () => resolve(fake.split(request)) }))
  const { result } = setup()
  split(result)
  await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(1))
  act(() => result.current.splitting.split(A, TEXT, TEXT.indexOf('two')))
  await act(async () => finish())
  expect(queries.splitSegment).toHaveBeenCalledTimes(1)
})

describe('following the split', () => {
  async function splitThenMove(move: (result: Hook) => void) {
    let finish!: () => void
    queries.splitSegment.mockImplementationOnce((request: SplitSegmentRequest) => new Promise((resolve) => { finish = () => resolve(fake.split(request)) }))
    const { result } = setup()
    split(result)
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(1))
    act(() => move(result))
    await act(async () => finish())
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    return result
  }

  it('stays on another segment the user started editing meanwhile', async () => {
    const result = await splitThenMove((r) => r.current.editing.setEditingId(BEFORE))
    expect(result.current.editing.editingId).toBe(BEFORE)
  })

  it('stays closed if the user closed the editor meanwhile', async () => {
    const result = await splitThenMove((r) => r.current.editing.setEditingId(null))
    expect(result.current.editing.editingId).toBeNull()
  })

  it('also stays put when the split is found on a resend', async () => {
    jest.useFakeTimers()
    try {
      let attempts = 0
      queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => {
        attempts++
        const rows = fake.split(req)
        if (attempts === 1) throw LOST // committed, but the answer was lost
        return rows
      })
      const { result } = setup({ resend: true })
      split(result)
      await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
      expect(attempts).toBe(1)
      act(() => result.current.editing.setEditingId(BEFORE))
      await act(async () => { await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0]) })
      expect(attempts).toBe(2)
      expect(ids(result)).toHaveLength(3)
      expect(result.current.editing.editingId).toBe(BEFORE)
    } finally {
      jest.useRealTimers()
    }
  })
})

it('writes a waiting draft first, through the queue, without deadlocking', async () => {
  const { result } = setup()
  act(() => result.current.editing.scheduleSave(A, 'One two.  Three four.'))
  split(result, 'One two.  Three four.', 10)
  await waitFor(() => expect(ids(result)).toHaveLength(3))
  expect(calls.slice(0, 2)).toEqual(['save A', 'split'])
})

it('drops a draft overtaken elsewhere with its text to copy, and never splits', async () => {
  const { result } = setup()
  act(() => result.current.editing.scheduleSave(A, 'One two.  Three four.'))
  fake.find(A)!.text = 'External text'
  split(result, 'One two.  Three four.', 10)
  await waitFor(() => expect(calls).toContain('reload'))
  await waitFor(() => expect(result.current.holds.any).toBe(false))
  expect(queries.splitSegment).not.toHaveBeenCalled()
  expect(fake.find(A)!.text).toBe('External text')
  expect(texts(result)[1]).toBe('External text')
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: 'Copy text' }) }))
  expect(result.current.history.canUndo).toBe(false)
})

it('drops a refused split and skips an undo pressed before it was refused', async () => {
  queries.splitSegment.mockRejectedValueOnce(refusal('SP003'))
  const { result } = setup()
  split(result)
  act(() => result.current.history.undo())
  await waitFor(() => expect(result.current.holds.any).toBe(false))
  expect(ids(result)).toHaveLength(2)
  expect(queries.rejoinSegments).not.toHaveBeenCalled()
  expect(result.current.history.canUndo).toBe(false)
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't split" }))
})

describe('undo and redo', () => {
  it('undo restores exactly the text that was split; redo reuses the new id at the current revision', async () => {
    const { result } = setup()
    // Typed: a line break where the cut goes, saved ahead of the split.
    act(() => result.current.editing.scheduleSave(A, 'One two.\nThree four.'))
    split(result, 'One two.\nThree four.', 'One two.\n'.length)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    const newId = ids(result)[2]
    act(() => result.current.history.undo())
    await waitFor(() => expect(ids(result)).toHaveLength(2))
    // Not 'One two. Three four.': the line break comes back as it was.
    expect(texts(result)[1]).toBe('One two.\nThree four.')
    expect(wordIds(result, A)).toEqual(W)
    act(() => result.current.history.redo())
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    expect(ids(result)[2]).toBe(newId)
    expect(splitRequests()[1]).toMatchObject({ newSegmentId: newId, expectedRevision: 2, expectedText: 'One two.\nThree four.' })
  })

  it('nested splits undo in press order, even pressed before either has run', async () => {
    const { result } = setup()
    split(result)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    act(() => result.current.splitting.split(A, 'One two.', 4))
    await waitFor(() => expect(ids(result)).toHaveLength(4))
    act(() => { result.current.history.undo(); result.current.history.undo() })
    await waitFor(() => expect(ids(result)).toHaveLength(2))
    expect(texts(result)[1]).toBe(TEXT)
    expect(queries.rejoinSegments).toHaveBeenCalledTimes(2)
    expect(result.current.history.redoLabel).toBe('split')
  })

  it('undo immediately followed by redo ends split, under the same id', async () => {
    const { result } = setup()
    split(result)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    const newId = ids(result)[2]
    act(() => { result.current.history.undo(); result.current.history.redo() })
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    expect(ids(result)[2]).toBe(newId)
  })

  it('undo writes a waiting draft of either half first', async () => {
    const { result } = setup()
    split(result)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    const newId = ids(result)[2]
    act(() => result.current.editing.scheduleSave(newId, 'Three four.'))
    act(() => result.current.history.undo())
    await waitFor(() => expect(ids(result)).toHaveLength(2))
    expect(calls.filter((c) => c !== 'split')).toEqual(['save ' + newId, 'rejoin'])
  })

  it('is refused, never adopted, when another tab changed a half', async () => {
    const { result } = setup()
    split(result)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    const newId = ids(result)[2]
    fake.find(newId)!.speaker_id = uuid(0x81)
    act(() => result.current.history.undo())
    await waitFor(() => expect(calls).toContain('reload'))
    await waitFor(() => expect(result.current.holds.any).toBe(false))
    expect(fake.find(newId)!.speaker_id).toBe(uuid(0x81))
    expect(ids(result)).toHaveLength(3)
    expect(result.current.history.canUndo).toBe(false)
    expect(result.current.history.canRedo).toBe(false)
  })

  it('a split committed, then edited elsewhere, then resent is refused and the history cleared', async () => {
    jest.useFakeTimers()
    try {
      let attempts = 0
      queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => {
        attempts++
        if (attempts === 1) {
          fake.split(req)
          // Another tab edits the first half before the resend arrives.
          fake.find(A)!.text = 'One two, edited elsewhere.'
          throw LOST
        }
        return fake.split(req)
      })
      const { result } = setup({ resend: true })
      act(() => result.current.history.record({ label: 'earlier', touches: [], run: async () => {}, target: () => ({}) }))
      split(result)
      await act(async () => { await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0]) })
      await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
      expect(attempts).toBe(2)
      expect(calls).toContain('reload')
      expect(texts(result)).toEqual(['Before.', 'One two, edited elsewhere.', 'Three four.'])
      expect(result.current.history.canUndo).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})
