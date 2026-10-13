import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useEditorWriteQueue } from '@/app/editor/[id]/hooks/useEditorWriteQueue'
import { useLiveStore } from '@/app/editor/[id]/hooks/useLiveStore'
import { useSegmentSplit } from '@/app/editor/[id]/hooks/useSegmentSplit'
import { useTranscriptMutations } from '@/app/editor/[id]/hooks/useTranscriptMutations'
import { compareSegments } from '@/app/editor/[id]/hooks/segmentSplit'
import { groupSourceWords } from '@/app/editor/[id]/utils'
import type { Seg, WordsBySegment } from '@/app/editor/[id]/types'
import type { RejoinSegmentsRequest, SplitSegmentRequest } from '@/lib/supabase/queries'

jest.mock('@/lib/supabase/queries', () => ({
  updateSegment: jest.fn(),
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

const stamp = '2026-10-13T00:00:00Z'
const seg = (id: string, start_ms: number, end_ms: number, text: string): Seg => ({
  id, transcript_id: 't1', speaker_id: 'sp1', diarization_index: 0, start_ms, end_ms, text,
  is_edited: false, is_filler: false, algo_version: 'test', revision: 0, created_at: stamp, updated_at: stamp,
})
type WordRow = { id: string; segment_id: string; start_ms: number; end_ms: number; text: string; punctuated_text: null; order_index: number }
const wordRow = (id: string, segment_id: string, start_ms: number, text: string, order_index: number): WordRow =>
  ({ id, segment_id, start_ms, end_ms: start_ms + 150, text, punctuated_text: null, order_index })

const STALE = { code: 'PGRST116', message: 'no rows' }
const LOST = { code: '', message: 'TypeError: Failed to fetch' }
const refusal = (code: string) => ({ code, message: code })

/** The database the editor talks to: the split functions' rules, in memory. */
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
    update(id: string, { text }: { text: string }, revision: number) {
      const s = find(id)
      if (!s || s.revision !== revision) throw STALE
      s.text = text
      return { ...s }
    },
    split(req: SplitSegmentRequest): [Seg, Seg] {
      const s = find(req.segmentId)
      if (!s) throw refusal('SP001')
      const made = find(req.newSegmentId)
      if (made) {
        if (made.revision === 0 && s.revision === req.expectedRevision + 1 &&
            wordsOf(made.id).some((w) => w.id === req.splitWordId)) return [{ ...s }, { ...made }]
        throw refusal('SP002')
      }
      if (s.revision !== req.expectedRevision) throw refusal('SP002')
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
        if (s.revision === req.expectedRevision + 1 &&
            db.words.some((w) => w.id === req.nextFirstWordId && w.segment_id === s.id)) return { ...s }
        throw refusal('SP002')
      }
      if (s.revision !== req.expectedRevision || n.revision !== req.expectedNextRevision) throw refusal('SP002')
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

function setup() {
  const initial = fake.db.segments.map((s) => ({ ...s }))
  const initialWords: WordsBySegment = groupSourceWords(fake.db.words.map((w) => ({ ...w })))
  return renderHook(() => {
    const [segments, setSegments] = useState(initial)
    const [words, setWords] = useState<WordsBySegment>(initialWords)
    const enqueue = useEditorWriteQueue()
    const segmentsStore = useLiveStore(segments, setSegments)
    const wordsStore = useLiveStore(words, setWords)
    const editing = useTranscriptMutations({ transcriptId: 't1', segments: segmentsStore, words: wordsStore, enqueue })
    const splitting = useSegmentSplit({
      segments: segmentsStore, words: wordsStore, enqueue, editingId: editing.editingId,
      setEditingTexts: editing.setEditingTexts, flushSave: editing.flushSave,
      reloadSegments: editing.reloadSegments, openEditorAt: editing.openEditorAt,
    })
    return { editing, splitting, segments, words }
  })
}

type Hook = ReturnType<typeof setup>['result']
const ids = (result: Hook) => result.current.segments.map((s) => s.id)
const texts = (result: Hook) => result.current.segments.map((s) => s.text)
const wordIds = (result: Hook, id: string) => (result.current.words.get(id) ?? []).map((w) => w.id)
const toastWith = (pick: (options: { title: string; action?: { label: string } }) => boolean) =>
  toast.mock.calls.map(([options]: [{ title: string; action?: { label: string; onClick: () => void } }]) => options).find(pick)
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
  queries.updateSegment.mockImplementation(async (id: string, update: { text: string }, revision: number) => {
    calls.push(`save ${id === A ? 'A' : id}`)
    return fake.update(id, update, revision)
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

describe('split', () => {
  it('waits for the database, then shows both halves and offers Undo', async () => {
    let answer!: () => void
    queries.splitSegment.mockImplementationOnce((req: SplitSegmentRequest) =>
      new Promise((resolve) => { answer = () => resolve(fake.split(req)) }))
    const { result } = setup()
    split(result)

    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalled())
    // Nothing changes on screen until the database answers; the segment is busy.
    expect(ids(result)).toEqual([BEFORE, A])
    expect(result.current.splitting.busy.get(A)).toBe('splitting')
    expect(result.current.splitting.anyBusy).toBe(true)

    await act(async () => { answer() })
    const newId = splitRequests()[0].newSegmentId
    await waitFor(() => expect(ids(result)).toEqual([BEFORE, A, newId]))
    expect(texts(result)).toEqual(['Before.', 'One two.', 'Three four.'])
    expect(wordIds(result, A)).toEqual(W.slice(0, 2))
    expect(wordIds(result, newId)).toEqual(W.slice(2))
    expect(result.current.segments[2]).toMatchObject({ speaker_id: 'sp1', diarization_index: 0, start_ms: 1500 })
    expect(result.current.editing.editingId).toBe(newId)
    expect(result.current.editing.caretHint(newId)).toBe(0)
    expect(result.current.splitting.anyBusy).toBe(false)
    expect(toastWith((o) => o.action?.label === 'Undo')!.title).toBe('Segment split')
  })

  it('sends the cut the caret makes, against the revision the text was edited against', async () => {
    const { result } = setup()
    split(result)
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalled())
    expect(splitRequests()[0]).toMatchObject({
      segmentId: A, expectedRevision: 0, splitWordId: W[2], firstText: 'One two.', secondText: 'Three four.',
    })
  })

  it('does nothing where there is no split', async () => {
    const { result } = setup()
    split(result, TEXT, 0)
    split(result, TEXT, TEXT.length)
    await act(async () => {})
    expect(queries.splitSegment).not.toHaveBeenCalled()
    expect(result.current.splitting.anyBusy).toBe(false)
  })

  it('turns a second split away while the first is pending', async () => {
    queries.splitSegment.mockImplementationOnce(() => new Promise(() => {}))
    const { result } = setup()
    split(result)
    split(result, TEXT, TEXT.indexOf('two'))
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(queries.splitSegment).toHaveBeenCalledTimes(1)
  })

  // Codex: flushSave inside the queue would deadlock.
  it('saves a pending draft first, through the real queue, without deadlocking', async () => {
    const { result } = setup()
    act(() => result.current.editing.scheduleSave(A, 'One two. Three four, edited.'))
    split(result, 'One two. Three four, edited.')
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    expect(calls).toEqual(['save A', 'split'])
    expect(texts(result)).toEqual(['Before.', 'One two.', 'Three four, edited.'])
  })

  // Codex: a stale draft must not be flushed into a segment split elsewhere.
  it('refuses a draft edited against a shape another tab changed, and never splits', async () => {
    const { result } = setup()
    act(() => result.current.editing.scheduleSave(A, 'One two. Three four, edited here.'))
    // Another tab splits A first.
    fake.split({ segmentId: A, expectedRevision: 0, splitWordId: W[1], firstText: 'One', secondText: 'two. Three four.', newSegmentId: uuid(0xe1) })
    split(result, 'One two. Three four, edited here.')

    await waitFor(() => expect(toastWith((o) => o.title === 'Changed in another tab — refreshed')).toBeTruthy())
    expect(queries.splitSegment).not.toHaveBeenCalled()
    // The database's shape, nothing duplicated.
    expect(texts(result)).toEqual(['Before.', 'One', 'two. Three four.'])
    expect(fake.db.segments.map((s) => s.text)).toEqual(['Before.', 'One', 'two. Three four.'])
    expect(result.current.splitting.anyBusy).toBe(false)
  })

  it('stops if the draft could not be saved, and says so', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    queries.updateSegment.mockRejectedValueOnce(new Error('offline'))
    const { result } = setup()
    act(() => result.current.editing.scheduleSave(A, 'One two. Three four, edited.'))
    split(result, 'One two. Three four, edited.')
    await waitFor(() => expect(toastWith((o) => o.title === "Couldn't split — your latest edit isn't saved yet")).toBeTruthy())
    expect(queries.splitSegment).not.toHaveBeenCalled()
    expect(result.current.splitting.anyBusy).toBe(false)
    consoleSpy.mockRestore()
  })

  describe('when the answer is lost', () => {
    it('replays the same request and applies a split that had committed once', async () => {
      queries.splitSegment.mockImplementationOnce(async (req: SplitSegmentRequest) => {
        fake.split(req)
        throw LOST
      })
      const { result } = setup()
      split(result)
      await waitFor(() => expect(ids(result)).toHaveLength(3))
      const [first, replay] = splitRequests()
      expect(replay).toEqual(first)
      expect(fake.db.segments).toHaveLength(3)
      expect(wordIds(result, first.newSegmentId)).toEqual(W.slice(2))
      expect(toastWith((o) => o.action?.label === 'Undo')).toBeTruthy()
    })

    it('replays the same request and splits when nothing had committed', async () => {
      queries.splitSegment.mockRejectedValueOnce(LOST)
      const { result } = setup()
      split(result)
      await waitFor(() => expect(ids(result)).toHaveLength(3))
      expect(splitRequests()).toHaveLength(2)
      expect(splitRequests()[1]).toEqual(splitRequests()[0])
    })

    it('stays busy behind Retry while the database cannot be reached, then replays the same id', async () => {
      queries.splitSegment.mockRejectedValue(LOST)
      const { result } = setup()
      split(result)
      await waitFor(() => expect(result.current.splitting.busy.get(A)).toBe('unconfirmed'))
      // The first try and three replays.
      expect(splitRequests()).toHaveLength(4)
      const retry = toastWith((o) => o.action?.label === 'Retry') as { title: string; action: { onClick: () => void } }
      expect(retry.title).toBe("Couldn't reach the server to finish the split")
      expect(ids(result)).toEqual([BEFORE, A])

      queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => fake.split(req))
      act(() => retry.action.onClick())
      await waitFor(() => expect(ids(result)).toHaveLength(3))
      expect(new Set(splitRequests().map((req) => req.newSegmentId)).size).toBe(1)
      expect(result.current.splitting.anyBusy).toBe(false)
    })

    // Codex: the toast can be swiped away; the card keeps Retry.
    it('retries from the card once the toast is gone, and a late toast Retry then does nothing', async () => {
      queries.splitSegment.mockRejectedValue(LOST)
      const { result } = setup()
      split(result)
      await waitFor(() => expect(result.current.splitting.busy.get(A)).toBe('unconfirmed'))
      const toastRetry = toastWith((o) => o.action?.label === 'Retry') as { action: { onClick: () => void } }

      queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => fake.split(req))
      act(() => {
        result.current.splitting.retry(A)
        // A second click before the replay runs is turned away.
        result.current.splitting.retry(A)
      })
      await waitFor(() => expect(ids(result)).toHaveLength(3))
      expect(splitRequests()).toHaveLength(5)
      expect(result.current.splitting.anyBusy).toBe(false)

      act(() => toastRetry.action.onClick())
      await act(async () => {})
      expect(splitRequests()).toHaveLength(5)
      expect(toast.mock.calls.filter(([o]: [{ title: string }]) => o.title === 'Segment split')).toHaveLength(1)
    })

    // Codex: a refresh can show the new half while the split is unconfirmed;
    // typing there would be overwritten when the replay confirms the split.
    it('keeps the new half closed while unconfirmed, even once a reload shows it', async () => {
      queries.splitSegment.mockRejectedValue(LOST)
      queries.splitSegment.mockImplementationOnce(async (req: SplitSegmentRequest) => {
        fake.split(req)
        throw LOST
      })
      const { result } = setup()
      split(result)
      await waitFor(() => expect(result.current.splitting.busy.get(A)).toBe('unconfirmed'))
      const newId = splitRequests()[0].newSegmentId

      // Back on the tab, the refresh finds the split the lost answer hid.
      await act(async () => { await result.current.editing.reloadSegments() })
      expect(ids(result)).toEqual([BEFORE, A, newId])
      expect(result.current.splitting.busy.get(newId)).toBe('unconfirmed')

      // Retry from the new half's card settles it, and frees both halves.
      queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => fake.split(req))
      act(() => result.current.splitting.retry(newId))
      await waitFor(() => expect(result.current.splitting.anyBusy).toBe(false))
      expect(new Set(splitRequests().map((req) => req.newSegmentId)).size).toBe(1)
      expect(texts(result)).toEqual(['Before.', 'One two.', 'Three four.'])
    })

    it('offers no card Retry for a segment that is not waiting on one', async () => {
      const { result } = setup()
      act(() => result.current.splitting.retry(A))
      await act(async () => {})
      expect(queries.splitSegment).not.toHaveBeenCalled()
    })

    // Codex: a replay must not apply captured words after a later change.
    it('reloads instead of applying captured words when the halves changed after the lost answer', async () => {
      queries.splitSegment.mockImplementationOnce(async (req: SplitSegmentRequest) => {
        const [, made] = fake.split(req)
        // Another tab splits the new half again before the replay.
        fake.split({ segmentId: made.id, expectedRevision: 0, splitWordId: W[3], firstText: 'Three', secondText: 'four.', newSegmentId: uuid(0xe2) })
        throw LOST
      })
      const { result } = setup()
      split(result)
      await waitFor(() => expect(ids(result)).toHaveLength(4))
      const newId = splitRequests()[0].newSegmentId
      // The database's words, not the captured suffix: the new half keeps only its own.
      expect(wordIds(result, newId)).toEqual([W[2]])
      expect(wordIds(result, uuid(0xe2))).toEqual([W[3]])
      expect(texts(result)).toEqual(['Before.', 'One two.', 'Three', 'four.'])
      expect(result.current.editing.editingId).toBe(newId)
      expect(toastWith((o) => o.title === 'Segment split — changed in another tab since')).toBeTruthy()
    })
  })

  // Codex: words read apart from their segment's revision could make a later
  // split pass the revision check yet divide the wrong words locally.
  it('after a reload, a further split divides exactly the words the database holds', async () => {
    const E = uuid(0xe5)
    const { result } = setup()
    // Another tab splits A before "two.": A keeps "One", E takes the rest.
    fake.split({ segmentId: A, expectedRevision: 0, splitWordId: W[1], firstText: 'One', secondText: 'two. Three four.', newSegmentId: E })
    await act(async () => { await result.current.editing.reloadSegments() })
    expect(wordIds(result, A)).toEqual([W[0]])

    act(() => result.current.splitting.split(E, 'two. Three four.', 'two. '.length))
    await waitFor(() => expect(ids(result)).toHaveLength(4))
    const newId = splitRequests()[0].newSegmentId
    const stored = (id: string) => fake.db.words.filter((w) => w.segment_id === id)
      .sort((a, b) => a.order_index - b.order_index).map((w) => w.id)
    for (const id of [A, E, newId]) expect(wordIds(result, id)).toEqual(stored(id))
    expect(wordIds(result, E)).toEqual([W[1]])
    expect(wordIds(result, newId)).toEqual([W[2], W[3]])
  })

  it('reports a refusal without changing anything', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    queries.splitSegment.mockRejectedValueOnce(refusal('SP003'))
    const { result } = setup()
    split(result)
    await waitFor(() => expect(toastWith((o) => o.title === "Couldn't split this segment")).toBeTruthy())
    expect(ids(result)).toEqual([BEFORE, A])
    expect(result.current.splitting.anyBusy).toBe(false)
    consoleSpy.mockRestore()
  })
})

// Codex: a late answer must not pull the editor off a segment the user moved to.
describe('where editing goes once the split is confirmed', () => {
  function answerLater() {
    let answer!: () => void
    queries.splitSegment.mockImplementationOnce((req: SplitSegmentRequest) =>
      new Promise((resolve) => { answer = () => resolve(fake.split(req)) }))
    return () => answer()
  }

  it('stays on another segment the user started editing meanwhile', async () => {
    const answer = answerLater()
    const { result } = setup()
    split(result)
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalled())
    act(() => result.current.editing.setEditingId(BEFORE))

    await act(async () => { answer() })
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    expect(result.current.editing.editingId).toBe(BEFORE)
    expect(toastWith((o) => o.action?.label === 'Undo')).toBeTruthy()
  })

  it('stays closed if the user closed the editor meanwhile', async () => {
    const answer = answerLater()
    const { result } = setup()
    split(result)
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalled())
    act(() => result.current.editing.setEditingId(null))

    await act(async () => { answer() })
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    expect(result.current.editing.editingId).toBeNull()
  })

  it('also stays put when the split is found after a reload', async () => {
    queries.splitSegment.mockImplementationOnce(async (req: SplitSegmentRequest) => {
      const [, made] = fake.split(req)
      fake.split({ segmentId: made.id, expectedRevision: 0, splitWordId: W[3], firstText: 'Three', secondText: 'four.', newSegmentId: uuid(0xe2) })
      throw LOST
    })
    const { result } = setup()
    split(result)
    act(() => result.current.editing.setEditingId(BEFORE))
    await waitFor(() => expect(ids(result)).toHaveLength(4))
    expect(result.current.editing.editingId).toBe(BEFORE)
  })
})

describe('undo', () => {
  async function splitThenUndoToast(result: Hook) {
    split(result)
    await waitFor(() => expect(ids(result)).toHaveLength(3))
    return toastWith((o) => o.action?.label === 'Undo') as { action: { onClick: () => void } }
  }

  it('joins the halves as they are now, saving drafts first', async () => {
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    const newId = splitRequests()[0].newSegmentId
    act(() => result.current.editing.scheduleSave(newId, 'Three four, typed after.'))
    calls = []

    act(() => undo.action.onClick())
    await waitFor(() => expect(ids(result)).toEqual([BEFORE, A]))
    expect(calls).toEqual([`save ${newId}`, 'rejoin'])
    expect(queries.rejoinSegments).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: A, expectedRevision: 1, nextSegmentId: newId, expectedNextRevision: 0,
      nextFirstWordId: W[2], text: 'One two. Three four, typed after.',
    }))
    expect(wordIds(result, A)).toEqual(W)
    expect(result.current.words.has(newId)).toBe(false)
    // Editing was on the new half: it moves to the join point.
    expect(result.current.editing.editingId).toBe(A)
    expect(result.current.editing.caretHint(A)).toBe('One two. '.length)
    expect(result.current.segments[1]).toMatchObject({ start_ms: 1000, end_ms: 2000 })
  })

  // Codex: a refused undo must not leave drafts unsaved.
  it('leaves nothing unsaved when the database refuses it', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    const newId = splitRequests()[0].newSegmentId
    act(() => {
      result.current.editing.scheduleSave(A, 'One two, edited.')
      result.current.editing.scheduleSave(newId, 'Three four, edited.')
    })
    queries.rejoinSegments.mockRejectedValueOnce(refusal('SP003'))

    act(() => undo.action.onClick())
    await waitFor(() => expect(toastWith((o) => o.title === "Couldn't undo")).toBeTruthy())
    expect(fake.db.segments.map((s) => s.text)).toEqual(['Before.', 'One two, edited.', 'Three four, edited.'])
    expect(result.current.splitting.anyBusy).toBe(false)
    // No save still waiting to run.
    const saves = queries.updateSegment.mock.calls.length
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(queries.updateSegment.mock.calls.length).toBe(saves)
  })

  it('waits behind a pending split of the new half, and builds from its result', async () => {
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    const newId = splitRequests()[0].newSegmentId
    let answer!: () => void
    queries.splitSegment.mockImplementationOnce((req: SplitSegmentRequest) =>
      new Promise((resolve) => { answer = () => resolve(fake.split(req)) }))
    act(() => result.current.splitting.split(newId, 'Three four.', 'Three '.length))
    await waitFor(() => expect(queries.splitSegment).toHaveBeenCalledTimes(2))

    act(() => undo.action.onClick())
    await act(async () => {})
    expect(queries.rejoinSegments).not.toHaveBeenCalled()

    await act(async () => { answer() })
    await waitFor(() => expect(queries.rejoinSegments).toHaveBeenCalled())
    expect(queries.rejoinSegments).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: A, expectedRevision: 1, nextSegmentId: newId, expectedNextRevision: 1,
      nextFirstWordId: W[2], text: 'One two. Three',
    }))
    await waitFor(() => expect(texts(result)).toEqual(['Before.', 'One two. Three', 'four.']))
  })

  // Codex: a split of the new half that ends unconfirmed may never have
  // happened; joining over it would orphan its Retry and leave the editor busy.
  it('is turned away while a split of either half is unconfirmed, and nothing is joined', async () => {
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    const newId = splitRequests()[0].newSegmentId
    // The second split never reaches the database.
    queries.splitSegment.mockRejectedValue(LOST)
    act(() => result.current.splitting.split(newId, 'Three four.', 'Three '.length))
    act(() => undo.action.onClick())

    await waitFor(() => expect(toastWith((o) => o.title === "Can't undo yet")).toBeTruthy())
    expect(queries.rejoinSegments).not.toHaveBeenCalled()
    expect(ids(result)).toEqual([BEFORE, A, newId])
    expect(result.current.splitting.busy.get(newId)).toBe('unconfirmed')
    expect(result.current.splitting.busy.has(A)).toBe(false)

    // Its Retry is still reachable, and settles the editor.
    queries.splitSegment.mockImplementation(async (req: SplitSegmentRequest) => fake.split(req))
    act(() => result.current.splitting.retry(newId))
    await waitFor(() => expect(result.current.splitting.anyBusy).toBe(false))
    expect(ids(result)).toHaveLength(4)
  })

  it('reloads and says so when the halves changed elsewhere', async () => {
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    const newId = splitRequests()[0].newSegmentId
    // Another tab edits the shape of the new half.
    fake.split({ segmentId: newId, expectedRevision: 0, splitWordId: W[3], firstText: 'Three', secondText: 'four.', newSegmentId: uuid(0xe3) })

    act(() => undo.action.onClick())
    await waitFor(() => expect(toastWith((o) => o.title === "Can't undo — changed since")).toBeTruthy())
    expect(texts(result)).toEqual(['Before.', 'One two.', 'Three', 'four.'])
  })

  it('replays a lost undo and applies it once', async () => {
    const { result } = setup()
    const undo = await splitThenUndoToast(result)
    queries.rejoinSegments.mockImplementationOnce(async (req: RejoinSegmentsRequest) => {
      fake.rejoin(req)
      throw LOST
    })
    act(() => undo.action.onClick())
    await waitFor(() => expect(ids(result)).toEqual([BEFORE, A]))
    expect(queries.rejoinSegments).toHaveBeenCalledTimes(2)
    expect(texts(result)).toEqual(['Before.', TEXT])
  })
})
