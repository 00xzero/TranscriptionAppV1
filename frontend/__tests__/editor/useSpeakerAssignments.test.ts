import { act, renderHook, waitFor } from '@testing-library/react'
import { useEditorHistory } from '@/app/editor/[id]/hooks/useEditorHistory'
import { useSegmentHolds } from '@/app/editor/[id]/hooks/useSegmentHolds'
import { useState, useRef } from 'react'
import { useSpeakerAssignments } from '../../app/editor/[id]/hooks/useSpeakerAssignments'
import { useEditorWriteQueue } from '../../app/editor/[id]/hooks/useEditorWriteQueue'
import { useLiveStore } from '../../app/editor/[id]/hooks/useLiveStore'
import { SPEAKER_COLORS } from '@/lib/speakers/palette'
import type { EditorPeopleContext, EditorPerson, Speaker } from '@/contracts/db'
import type { Seg } from '../../app/editor/[id]/types'
import type { Send } from '@/lib/editor/untilAnswered'

const sendOnce: Send = (call) => call()

jest.mock('@/lib/supabase/queries', () => ({
  reassignSegments: jest.fn(),
  setSpeakerCustomLabel: jest.fn(),
  createLocalSpeaker: jest.fn(),
  correctSegmentsToPerson: jest.fn(),
  renamePerson: jest.fn(),
  undoCreatedPerson: jest.fn(),
  restoreCreatedPerson: jest.fn(),
  fetchSegmentSpeakerAssignments: jest.fn(),
  fetchSpeakers: jest.fn(),
  fetchEditorPeopleContext: jest.fn(),
}))
jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))

const queries = jest.requireMock('@/lib/supabase/queries')
const { toast } = jest.requireMock('@/components/ui/toaster')

const stamp = '2026-01-01T00:00:00Z'
// 'a' and 'b' are Deepgram's speakers 0 and 1, shown from 1 as Speaker 1 and
// Speaker 2; named speakers carry no Deepgram number.
const detected = (id: string, index: number): Speaker => ({
  id, transcript_id: 't1', user_id: 'u1', ordinal: index + 1, custom_label: null, diarization_index: index,
  person_id: null, created_at: stamp, updated_at: stamp,
})
const named = (id: string, ordinal: number, patch: Pick<Speaker, 'custom_label' | 'person_id'>): Speaker => ({
  ...detected(id, ordinal), diarization_index: null, ...patch,
})
const segment = (id: string, speaker_id: string | null, start_ms: number, diarization_index: number | null = 0): Seg => ({
  id, transcript_id: 't1', speaker_id, diarization_index, start_ms, end_ms: start_ms + 1000, text: `text ${id}`,
  is_edited: false, is_filler: false, algo_version: 'test', revision: 0, created_at: stamp, updated_at: stamp,
})
const alex: EditorPerson = {
  id: 'p1', user_id: 'u1', name: 'Alex', organisation_id: null, organisation_name: null,
  preferred_color: SPEAKER_COLORS[0], hidden: false, created_at: stamp, updated_at: stamp,
  other_transcript_count: 1, last_other_title: null, last_other_seen_at: null, in_project: false,
}
const context: EditorPeopleContext = { people: [alex] }
const anchor = { getBoundingClientRect: () => new DOMRect() }
const alexHere = named('c', 3, { custom_label: null, person_id: 'p1' })

/** Whether the editor's first load has shown segments; most tests start after it. */
let loaded = true

function setup(initialSpeakers = [detected('a', 0), detected('b', 1)],
  initialSegments = [segment('s1', 'a', 0), segment('s2', 'a', 1000)]) {
  // By default a refresh finds the database as the editor holds it.
  queries.fetchSegmentSpeakerAssignments.mockImplementation(async () => rendered.result.current.segments
    .map(({ id, speaker_id, revision }) => ({ id, speaker_id, revision })))
  queries.fetchSpeakers.mockResolvedValue(initialSpeakers)
  queries.fetchEditorPeopleContext.mockResolvedValue(context)
  const reloadSegments = jest.fn().mockResolvedValue(true)
  const rendered = renderHook(() => {
    const [speakers, setSpeakers] = useState(initialSpeakers)
    const [segments, setSegments] = useState(initialSegments)
    const [peopleContext, setPeopleContext] = useState(context)
    const enqueue = useEditorWriteQueue()
    const segmentsStore = useLiveStore(segments, setSegments)
    const holds = useSegmentHolds()
    const refreshRef = useRef(async () => true)
    const history = useEditorHistory({ enqueue, holds, reveal: () => {}, refresh: () => refreshRef.current(),
      isReconnecting: () => false, reconnecting: false })
    const hook = useSpeakerAssignments({ transcriptId: 't1', speakers, segments, segmentsStore, peopleContext,
      setSpeakers, setPeopleContext, enqueue, reloadSegments, isLoaded: () => loaded, send: sendOnce, history, holds })
    refreshRef.current = hook.refresh
    return { ...hook, segments, speakers, peopleContext, enqueue, segmentsStore, history, holds }
  })
  const open = (id = 's1') => act(() => rendered.result.current.setSpeakerPopover({
    segmentId: id,
    speakerId: rendered.result.current.segments.find((row) => row.id === id)!.speaker_id,
    anchorMeasurable: anchor, triggerElement: null,
  }))
  const speakerIds = () => rendered.result.current.segments.map((row) => row.speaker_id)
  return { ...rendered, open, speakerIds, reloadSegments }
}

const toastWith = (label: string) => toast.mock.calls
  .map(([options]: [{ action?: { label: string; onClick: () => void } }]) => options)
  .find((options: { action?: { label: string } }) => options.action?.label === label)

beforeEach(() => {
  jest.clearAllMocks()
  loaded = true
  queries.reassignSegments.mockImplementation(async (_: string, changes: { segment_id: string; speaker_id: string | null }[]) =>
    changes.map(({ segment_id, speaker_id }) => ({ segment_id, speaker_id })))
})

test('two voices linked to one person count once and form one turn', () => {
  const { result, open } = setup([named('x', 3, { custom_label: null, person_id: 'p1' }),
    named('y', 4, { custom_label: null, person_id: 'p1' })], [segment('s1', 'x', 0), segment('s2', 'y', 1000)])
  open()
  expect(result.current.presentation.identities).toHaveLength(1)
  expect(result.current.scopes.turn.map((row) => row.id)).toEqual(['s1', 's2'])
  expect(result.current.scopes.speaker.map((row) => row.id)).toEqual(['s1', 's2'])
  expect(result.current.labelForSpeaker('x')).toBe('Alex')
  expect(result.current.displayForSpeaker('y').identityKey).toBe(result.current.displayForSpeaker('x').identityKey)
})

test('Remove restores an attributed segment that Deepgram left Unknown', async () => {
  const { result, open, speakerIds } = setup([alexHere], [segment('s1', 'c', 0, null)])
  open()
  expect(result.current.removable.segment).toBe(true)
  act(() => result.current.removeSpeaker('segment'))
  await waitFor(() => expect(speakerIds()).toEqual([null]))
  expect(queries.reassignSegments).toHaveBeenCalledWith('t1', [{
    segment_id: 's1', expected_speaker_id: 'c', expected_revision: 0, speaker_id: null,
  }])
  expect(toastWith('Undo')).toBeUndefined()
  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['c']))
})

test('Remove leaves a numbered segment alone when its detected speaker is missing', () => {
  // The database's foreign key rules this out; if it ever happened, the
  // segment must keep its speaker rather than be blanked to Unknown.
  const { result, open } = setup([alexHere], [segment('s1', 'c', 0, 4)])
  open()
  expect(result.current.removable).toEqual({ speaker: false, segment: false, turn: false })
})

test('a passage correction settles on the speaker the database chose', async () => {
  queries.correctSegmentsToPerson.mockResolvedValue({ speaker: alexHere, person: alex,
    assignments: [{ segment_id: 's1', speaker_id: 'c' }] })
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'person', id: 'p1' }, 'segment'))
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'a']))
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1',
    [{ segment_id: 's1', expected_speaker_id: 'a', expected_revision: 0 }], { personId: 'p1' })
  expect(result.current.speakers.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  expect(toastWith('Undo')).toBeUndefined()
  expect(queries.fetchSpeakers).not.toHaveBeenCalled()
})

test('a continuous turn sends every segment showing the identity', async () => {
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'turn'))
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(1))
  expect(queries.reassignSegments.mock.calls[0][1]).toEqual([
    { segment_id: 's1', expected_speaker_id: 'a', expected_revision: 0, speaker_id: 'b' },
    { segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0, speaker_id: 'b' },
  ])
})

// Codex: a split keeps the segment's id and speaker, so a correction chosen
// while it was whole must name the shape it saw, and so must its Undo.
test('a correction and its Undo name the revision of each segment they change', async () => {
  const { result, open, speakerIds } = setup(undefined,
    [{ ...segment('s1', 'a', 0), revision: 2 }, segment('s2', 'a', 1000)])
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'turn'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(queries.reassignSegments.mock.calls[0][1]).toEqual([
    { segment_id: 's1', expected_speaker_id: 'a', expected_revision: 2, speaker_id: 'b' },
    { segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0, speaker_id: 'b' },
  ])

  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'b', expected_revision: 2, speaker_id: 'a' },
    { segment_id: 's2', expected_speaker_id: 'b', expected_revision: 0, speaker_id: 'a' },
  ])
})

// Codex: an action runs after the writes queued ahead of it. One chosen for a
// whole segment while its split waited in the queue must not change only the
// first half.
describe('chosen while a split of the segment waits in the queue', () => {
  /** Queue a split of s1 at 500 ms that lands when the returned function runs. */
  async function pendingSplit(result: ReturnType<typeof setup>['result']) {
    let land!: () => void
    // Async, so the queue starts the task before anything is chosen.
    await act(async () => {
      void result.current.enqueue(() => new Promise<void>((resolve) => {
        land = () => {
          result.current.segmentsStore.update((rows) => [
            { ...rows[0], revision: 1, end_ms: 400 },
            { ...rows[0], id: 's1b', start_ms: 500, revision: 0 },
            ...rows.slice(1),
          ])
          resolve()
        }
      }))
    })
    return () => act(async () => { land() })
  }

  test.each([
    ['a correction', (r: ReturnType<typeof setup>['result']) => r.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment')],
    ['a removal', (r: ReturnType<typeof setup>['result']) => r.current.removeSpeaker('segment')],
    ['naming the detected speaker', (r: ReturnType<typeof setup>['result']) => r.current.renameLocal('Host')],
  ])('%s is turned away, and nothing is written', async (_name, choose) => {
    // s1 sits on b, though Deepgram gave it a, so Remove has work to do.
    const { result, open, speakerIds } = setup(undefined, [segment('s1', 'b', 0), segment('s2', 'a', 1000)])
    const land = await pendingSplit(result)
    open()
    act(() => choose(result))
    await land()

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'A segment was split or joined meanwhile', description: 'Nothing changed. Choose again.',
    })))
    expect(queries.reassignSegments).not.toHaveBeenCalled()
    expect(queries.createLocalSpeaker).not.toHaveBeenCalled()
    expect(speakerIds()).toEqual(['b', 'b', 'a'])
  })

  test('one chosen after the split landed goes ahead, naming the new revision', async () => {
    const { result, open } = setup()
    const land = await pendingSplit(result)
    await land()
    open()
    act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
    await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(1))
    expect(queries.reassignSegments.mock.calls[0][1]).toEqual([
      { segment_id: 's1', expected_speaker_id: 'a', expected_revision: 1, speaker_id: 'b' },
    ])
  })

  test('renaming a speaker label is not held up by a split', async () => {
    const guest = named('l', 3, { custom_label: 'Guest', person_id: null })
    queries.setSpeakerCustomLabel.mockResolvedValueOnce({ ...guest, custom_label: 'Host' })
    const { result, open } = setup([detected('a', 0), guest], [segment('s1', 'l', 0), segment('s2', 'a', 1000)])
    const land = await pendingSplit(result)
    open()
    act(() => result.current.renameLocal('Host'))
    await land()
    await waitFor(() => expect(queries.setSpeakerCustomLabel).toHaveBeenCalledWith('l', 'Guest', 'Host'))
  })
})

test('ordinary failure restores only the affected assignment and names the action as shown', async () => {
  queries.reassignSegments.mockRejectedValueOnce(new Error('offline'))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(toastWith('Retry')).toBeDefined())
  expect(toastWith('Retry')).toMatchObject({ title: "Couldn't move this segment to Speaker 2", variant: 'error' })
  expect(speakerIds()).toEqual(['a', 'a'])
  expect(result.current.segments.map((row) => row.text)).toEqual(['text s1', 'text s2'])
  expect(queries.fetchSpeakers).not.toHaveBeenCalled()
})

test('Retry reissues a failed guarded action', async () => {
  queries.reassignSegments.mockRejectedValueOnce(new Error('offline'))
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(toastWith('Retry')).toBeDefined())
  act(() => toastWith('Retry')!.action!.onClick())
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(2))
  expect(queries.reassignSegments.mock.calls[1][1]).toEqual(queries.reassignSegments.mock.calls[0][1])
})

test('speaker actions run one at a time within the transcript', async () => {
  let finishFirst!: (value: unknown) => void
  queries.reassignSegments.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
  const { result, open } = setup()
  open('s1')
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(1))
  open('s2')
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  expect(queries.reassignSegments).toHaveBeenCalledTimes(1)
  act(() => finishFirst([{ segment_id: 's1', speaker_id: 'b' }]))
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(2))
})

test('stale write refreshes speaker data and reports conflict', async () => {
  queries.reassignSegments.mockRejectedValueOnce({ code: 'SP002' })
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed' }))
})

test('a person merged away refreshes rather than retrying the failed correction', async () => {
  queries.correctSegmentsToPerson.mockRejectedValueOnce({ code: 'SP001' })
  const { result, open } = setup()
  queries.fetchEditorPeopleContext.mockResolvedValue({ people: [] })
  open()
  act(() => result.current.selectTarget({ kind: 'person', id: 'p1' }, 'segment'))
  await waitFor(() => expect(queries.fetchEditorPeopleContext).toHaveBeenCalledTimes(1))
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed' }))
  expect(toastWith('Retry')).toBeUndefined()
  expect(result.current.peopleContext.people).toEqual([])
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledTimes(1)
})

test('an unfinished transcript restores the optimistic edit without offering write Retry', async () => {
  queries.reassignSegments.mockRejectedValueOnce({ code: 'SP004' })
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith({
    title: 'Speaker changes are available when transcription is complete.', variant: 'error',
  }))
  expect(speakerIds()).toEqual(['a', 'a'])
  expect(toastWith('Retry')).toBeUndefined()
})

test('an action on state that is gone refreshes instead of writing', async () => {
  const { result, open } = setup([detected('a', 0), alexHere], [segment('s1', 'c', 0)])
  open()
  act(() => result.current.renameLocal('Named voice'))
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
  expect(queries.setSpeakerCustomLabel).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed' }))
})

test('identifying a detected speaker moves all its segments, and Undo moves them back', async () => {
  queries.correctSegmentsToPerson.mockResolvedValueOnce({ speaker: alexHere, person: alex,
    assignments: [{ segment_id: 's1', speaker_id: 'c' }, { segment_id: 's2', speaker_id: 'c' }] })
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'person', id: 'p1' }, 'speaker'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'a', expected_revision: 0 }, { segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0 },
  ], { personId: 'p1' })
  expect(toastWith('Undo')).toBeUndefined()
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
  expect(result.current.labelForSpeaker(speakerIds()[0])).toBe('Alex')
  // Deepgram's speaker keeps no name of its own.
  expect(result.current.speakers[0]).toMatchObject({ id: 'a', person_id: null, custom_label: null })
  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
    { segment_id: 's2', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
  ])
  expect(queries.fetchSpeakers).not.toHaveBeenCalled()
})

test('a failed identification keeps the names in its message', async () => {
  queries.correctSegmentsToPerson.mockRejectedValueOnce(new Error('offline'))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'person', id: 'p1' }, 'speaker'))
  await waitFor(() => expect(toastWith('Retry')).toBeDefined())
  expect(toastWith('Retry')!.title).toBe("Couldn't identify Speaker 1 as Alex")
  expect(speakerIds()).toEqual(['a', 'a'])
  expect(result.current.speakers.map((row) => row.id)).toEqual(['a', 'b'])
})

/** The database's answer to naming a detected speaker: the new speaker under the id the editor chose. */
const madeLocal = (label: string) => async (_t: string, _label: string, changes: { segment_id: string }[], speakerId: string) => ({
  speaker: named(speakerId, 3, { custom_label: label, person_id: null }),
  assignments: changes.map(({ segment_id }) => ({ segment_id, speaker_id: speakerId })),
})

test('naming a detected speaker in this transcript moves its segments to a new local speaker', async () => {
  queries.createLocalSpeaker.mockImplementationOnce(madeLocal('Host'))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(queries.createLocalSpeaker).toHaveBeenCalledWith('t1', 'Host', [
    { segment_id: 's1', expected_speaker_id: 'a', expected_revision: 0 }, { segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0 },
  ], expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
  const localId = queries.createLocalSpeaker.mock.calls[0][3]
  expect(toastWith('Undo')).toBeUndefined()
  await waitFor(() => expect(speakerIds()).toEqual([localId, localId]))
  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
  // Redo moves them to the same speaker again; the emptied one was kept.
  act(() => result.current.history.redo())
  await waitFor(() => expect(speakerIds()).toEqual([localId, localId]))
  expect(queries.createLocalSpeaker).toHaveBeenCalledTimes(1)
})

test('a local label write uses its old value as guard, and Undo the saved one', async () => {
  const guest = named('l', 3, { custom_label: 'Guest', person_id: null })
  queries.setSpeakerCustomLabel
    .mockResolvedValueOnce({ ...guest, custom_label: 'Host' })
    .mockResolvedValueOnce(guest)
  const { result, open } = setup([detected('a', 0), guest], [segment('s1', 'l', 0)])
  open()
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(queries.setSpeakerCustomLabel).toHaveBeenCalledWith('l', 'Guest', 'Host')
  expect(toastWith('Undo')).toBeUndefined()
  act(() => result.current.history.undo())
  await waitFor(() => expect(queries.setSpeakerCustomLabel).toHaveBeenLastCalledWith('l', 'Host', 'Guest'))
})

test('Remove is offered only where a segment is off its detected speaker', () => {
  const { result, open } = setup([detected('a', 0), detected('b', 1)],
    [segment('s1', 'a', 0), segment('s2', 'b', 1000, 0), segment('s3', 'b', 2000, 1)])
  open('s1')
  expect(result.current.removable).toEqual({ speaker: false, segment: false, turn: false })
  open('s3')
  expect(result.current.removable).toEqual({ speaker: true, segment: false, turn: true })
})

test('Remove sends segments back to the speaker Deepgram gave them, and nothing merges', async () => {
  // Deepgram heard all three as its speaker 0 (Speaker 1); the user named that voice Alex.
  const { result, open, speakerIds } = setup([detected('a', 0), detected('b', 1), alexHere],
    [segment('s1', 'c', 0), segment('s2', 'c', 1000), segment('s3', 'c', 2000)])
  open('s2')
  act(() => result.current.removeSpeaker('segment'))
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'a', 'c']))
  expect(toastWith('Undo')).toBeUndefined()
  open('s1')
  act(() => result.current.removeSpeaker('speaker'))
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a', 'a']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
    { segment_id: 's3', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
  ])
  expect(result.current.presentation.identities.map((identity) => identity.label)).toEqual(['Speaker 1'])
})

test('Removing a name from segments Deepgram split sends each to its own speaker', async () => {
  const { result, open, speakerIds } = setup([detected('a', 0), detected('b', 1), alexHere],
    [segment('s1', 'c', 0, 0), segment('s2', 'c', 1000, 1)])
  open()
  act(() => result.current.removeSpeaker('speaker'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(toastWith('Undo')).toBeUndefined()
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'b']))
  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
})

test('refreshes speaker data when the tab regains focus', async () => {
  setup()
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
})

// Codex: a refresh racing the first load could be overwritten by that load's
// rows, read a moment earlier, pairing old segments with newer words.
test('a tab return before the first load has shown segments leaves the load to it', async () => {
  loaded = false
  const { reloadSegments } = setup([detected('a', 0)], [])
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => {})
  expect(queries.fetchSegmentSpeakerAssignments).not.toHaveBeenCalled()
  expect(reloadSegments).not.toHaveBeenCalled()

  loaded = true
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(queries.fetchSegmentSpeakerAssignments).toHaveBeenCalledTimes(1))
})

test('a segment split or rejoined elsewhere reloads segments and words on return', async () => {
  const { reloadSegments } = setup()
  queries.fetchSegmentSpeakerAssignments.mockResolvedValueOnce([
    { id: 's1', speaker_id: 'a', revision: 1 }, { id: 's2', speaker_id: 'a', revision: 0 }, { id: 's3', speaker_id: 'a', revision: 0 },
  ])
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(reloadSegments).toHaveBeenCalledTimes(1))
  expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1)
})

test('an unchanged shape on return merges assignments without reloading', async () => {
  const { reloadSegments, speakerIds } = setup()
  queries.fetchSegmentSpeakerAssignments.mockResolvedValueOnce([
    { id: 's1', speaker_id: 'b', revision: 0 }, { id: 's2', speaker_id: 'a', revision: 0 },
  ])
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(speakerIds()).toEqual(['b', 'a']))
  expect(reloadSegments).not.toHaveBeenCalled()
})

test('a tab switch that fires both events refreshes once', async () => {
  let finish!: (rows: Speaker[]) => void
  const { result } = setup()
  queries.fetchSpeakers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => { finish(result.current.speakers) })
  expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1)
})

test('a person created inline shows the colour the database will assign', async () => {
  queries.correctSegmentsToPerson.mockImplementationOnce(() => new Promise(() => {}))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'speaker'))
  await waitFor(() => expect(result.current.labelForSpeaker(speakerIds()[0])).toBe('Blair'))
  expect(result.current.displayForSpeaker(speakerIds()[0]).color).toBe(SPEAKER_COLORS[1])
})

test('Undo after inline creation moves the segments back and removes the unchanged person', async () => {
  const createdPerson = { ...alex, id: 'created', name: 'Blair', updated_at: '2026-02-01T00:00:00Z' }
  queries.correctSegmentsToPerson.mockResolvedValueOnce({
    speaker: named('c', 3, { custom_label: null, person_id: 'created' }), person: createdPerson,
    assignments: [{ segment_id: 's1', speaker_id: 'c' }, { segment_id: 's2', speaker_id: 'c' }],
  })
  queries.undoCreatedPerson.mockResolvedValueOnce(undefined)
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'speaker'))
  await waitFor(() => expect(result.current.history.canUndo && !result.current.history.paused).toBe(true))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1', expect.any(Array),
    { newPersonName: 'Blair', newPersonId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) })
  await waitFor(() => expect(result.current.peopleContext.people.find((person) => person.id === 'created')?.organisation_name).toBeNull())
  act(() => result.current.history.undo())
  await waitFor(() => expect(queries.undoCreatedPerson).toHaveBeenCalledWith({
    transcriptId: 't1', speakerId: 'c', person: { id: 'created', name: 'Blair', preferred_color: alex.preferred_color },
    changes: [
      { segment_id: 's1', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
      { segment_id: 's2', expected_speaker_id: 'c', expected_revision: 0, speaker_id: 'a' },
    ],
  }))
  await waitFor(() => expect(result.current.peopleContext.people.map((person) => person.id)).toEqual(['p1']))
  expect(speakerIds()).toEqual(['a', 'a'])
  expect(result.current.speakers.find((row) => row.id === 'c')?.person_id).toBeNull()
})

test('an open picker closes when a refresh moves its segment to another speaker', async () => {
  const { result, open } = setup()
  open()
  queries.fetchSegmentSpeakerAssignments.mockResolvedValueOnce([
    { id: 's1', speaker_id: 'b', revision: 0 }, { id: 's2', speaker_id: 'a', revision: 0 },
  ])
  act(() => window.dispatchEvent(new Event('focus')))
  // Its Current row would still say Speaker 1 while All acted on Speaker 2.
  await waitFor(() => expect(result.current.speakerPopover).toBeNull())
  expect(result.current.segments[0].speaker_id).toBe('b')
})

test('an open picker stays open while a refresh leaves its segment where it was', async () => {
  const { result, open } = setup()
  open()
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
  expect(result.current.speakerPopover).not.toBeNull()
})

test('an open picker stays open when the speaker it opened on is saved', async () => {
  let save!: (value: unknown) => void
  queries.createLocalSpeaker.mockImplementationOnce(() => new Promise((resolve) => { save = resolve }))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(speakerIds()[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
  const localId = speakerIds()[0]!
  open('s2')
  const host = named(localId, 3, { custom_label: 'Host', person_id: null })
  await act(async () => save({ speaker: host,
    assignments: [{ segment_id: 's1', speaker_id: localId }, { segment_id: 's2', speaker_id: localId }] }))
  expect(speakerIds()).toEqual([localId, localId])
  expect(result.current.speakerPopover).not.toBeNull()
  expect(result.current.currentSpeaker?.id).toBe(localId)
})

test('a person picked while their creation is still saving is written under the id chosen for them', async () => {
  let save!: () => void
  let chosenId = ''
  const blairHere = named('c', 3, { custom_label: null, person_id: null })
  queries.correctSegmentsToPerson
    .mockImplementationOnce((_t: string, _changes: unknown, target: { newPersonId: string }) => {
      chosenId = target.newPersonId
      return new Promise((resolve) => {
        save = () => resolve({ speaker: { ...blairHere, person_id: chosenId }, person: { ...alex, id: chosenId, name: 'Blair' },
          assignments: [{ segment_id: 's1', speaker_id: 'c' }] })
      })
    })
    .mockImplementationOnce(async () => ({ speaker: { ...blairHere, person_id: chosenId }, person: { ...alex, id: chosenId, name: 'Blair' },
      assignments: [{ segment_id: 's2', speaker_id: 'c' }] }))
  const { result, open, speakerIds } = setup()
  open('s1')
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'segment'))
  await waitFor(() => expect(result.current.peopleContext.people.map((person) => person.name)).toContain('Blair'))
  const shownId = result.current.peopleContext.people.find((person) => person.name === 'Blair')!.id
  open('s2')
  act(() => result.current.selectTarget({ kind: 'person', id: shownId }, 'segment'))
  await act(async () => save())
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
  expect(shownId).toBe(chosenId)
  expect(queries.correctSegmentsToPerson).toHaveBeenLastCalledWith('t1',
    [{ segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0 }], { personId: chosenId })
  expect(toastWith('Undo')).toBeUndefined()
})

test('a local speaker picked while it is still saving is written under its saved id', async () => {
  let save!: (value: unknown) => void
  queries.createLocalSpeaker.mockImplementationOnce(() => new Promise((resolve) => { save = resolve }))
  const { result, open, speakerIds } = setup([detected('a', 0), detected('b', 1)],
    [segment('s1', 'a', 0), segment('s2', 'b', 1000, 1)])
  open('s1')
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(speakerIds()[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
  const localId = speakerIds()[0]!
  open('s2')
  act(() => result.current.selectTarget({ kind: 'speaker', id: localId }, 'segment'))
  await act(async () => save({ speaker: named(localId, 3, { custom_label: 'Host', person_id: null }),
    assignments: [{ segment_id: 's1', speaker_id: localId }] }))
  await waitFor(() => expect(speakerIds()).toEqual([localId, localId]))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1',
    [{ segment_id: 's2', expected_speaker_id: 'b', expected_revision: 0, speaker_id: localId }])
  expect(toastWith('Undo')).toBeUndefined()
})

test('a refused write whose refresh is refused too says so, and leaves the screen as it was', async () => {
  queries.reassignSegments.mockRejectedValueOnce({ code: 'SP002' })
  const { result, open, speakerIds } = setup()
  queries.fetchSpeakers.mockRejectedValueOnce({ code: '42501', message: 'denied' })
  jest.spyOn(console, 'error').mockImplementationOnce(() => {})
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Changed in another tab — couldn't refresh" })))
  expect(result.current.history.paused).toBe(false)
  expect(speakerIds()).toEqual(['a', 'a'])
})

test('undo of a new person expects the name and colour it was created with, after its rename is undone', async () => {
  let chosenId = ''
  queries.correctSegmentsToPerson.mockImplementationOnce(async (_t: string, _c: unknown, target: { newPersonId: string }) => {
    chosenId = target.newPersonId
    return { speaker: named('c', 3, { custom_label: null, person_id: chosenId }), person: { ...alex, id: chosenId, name: 'Blair' },
      assignments: [{ segment_id: 's1', speaker_id: 'c' }, { segment_id: 's2', speaker_id: 'c' }] }
  })
  queries.renamePerson
    .mockImplementationOnce(async (id: string) => ({ ...alex, id, name: 'Renamed', updated_at: '2026-02-01T00:01:00Z' }))
    .mockImplementationOnce(async (id: string) => ({ ...alex, id, name: 'Blair', updated_at: '2026-02-01T00:02:00Z' }))
  queries.undoCreatedPerson.mockResolvedValueOnce(undefined)
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'speaker'))
  await waitFor(() => expect(result.current.peopleContext.people.some((p) => p.id === chosenId)).toBe(true))
  open()
  act(() => result.current.renameLinkedPerson('Renamed'))
  await waitFor(() => expect(result.current.peopleContext.people.find((p) => p.id === chosenId)?.name).toBe('Renamed'))
  act(() => result.current.history.undo())
  await waitFor(() => expect(queries.renamePerson).toHaveBeenLastCalledWith(chosenId, 'Renamed', 'Blair'))
  act(() => result.current.history.undo())
  await waitFor(() => expect(queries.undoCreatedPerson).toHaveBeenCalledWith(expect.objectContaining({
    person: { id: chosenId, name: 'Blair', preferred_color: alex.preferred_color },
  })))
})

test('redo of a new person brings them back under the same id, name and colour', async () => {
  let chosenId = ''
  const speaker = (personId: string | null) => named('c', 3, { custom_label: null, person_id: personId })
  queries.correctSegmentsToPerson.mockImplementationOnce(async (_t: string, _c: unknown, target: { newPersonId: string }) => {
    chosenId = target.newPersonId
    return { speaker: speaker(chosenId), person: { ...alex, id: chosenId, name: 'Blair' },
      assignments: [{ segment_id: 's1', speaker_id: 'c' }, { segment_id: 's2', speaker_id: 'c' }] }
  })
  queries.undoCreatedPerson.mockResolvedValue(undefined)
  queries.restoreCreatedPerson.mockImplementation(async ({ person }: { person: { id: string } }) => ({
    speaker: speaker(person.id), person: { ...alex, id: person.id, name: 'Blair' },
    assignments: [{ segment_id: 's1', speaker_id: 'c' }, { segment_id: 's2', speaker_id: 'c' }],
  }))
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'speaker'))
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
  act(() => result.current.history.undo())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
  expect(result.current.peopleContext.people.some((p) => p.id === chosenId)).toBe(false)
  act(() => result.current.history.redo())
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
  expect(queries.restoreCreatedPerson).toHaveBeenCalledWith({
    transcriptId: 't1', speakerId: 'c', person: { id: chosenId, name: 'Blair', preferred_color: alex.preferred_color },
    changes: [{ segment_id: 's1', expected_speaker_id: 'a', expected_revision: 0 }, { segment_id: 's2', expected_speaker_id: 'a', expected_revision: 0 }],
  })
  expect(result.current.peopleContext.people.find((p) => p.id === chosenId)?.name).toBe('Blair')
  expect(result.current.speakers.find((row) => row.id === 'c')?.person_id).toBe(chosenId)
  // And undo again, as many times as wanted.
  act(() => result.current.history.undo())
  await waitFor(() => expect(queries.undoCreatedPerson).toHaveBeenCalledTimes(2))
})

test('a person linked here and changed in another tab clears the history on return', async () => {
  const { result } = setup([detected('a', 0), alexHere], [segment('s1', 'c', 0)])
  act(() => result.current.history.record({ label: 'person creation', touches: ['person:p1'], run: async () => {}, target: () => ({ ids: [] }) }))
  queries.fetchSpeakers.mockResolvedValue([detected('a', 0), alexHere])
  queries.fetchEditorPeopleContext.mockResolvedValueOnce({ people: [{ ...alex, hidden: true, updated_at: '2026-02-01T00:01:00Z' }] })
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(result.current.history.canUndo).toBe(false))
  act(() => result.current.history.undo())
  expect(queries.undoCreatedPerson).not.toHaveBeenCalled()
  expect(toast.mock.calls.filter(([options]: [{ description?: string }]) => options.description === 'Undo history cleared')).toHaveLength(1)
})

test('renaming to the same name records nothing, writes nothing and says nothing', async () => {
  const guest = named('l', 3, { custom_label: 'Guest', person_id: null })
  const { result, open } = setup([detected('a', 0), guest, alexHere], [segment('s1', 'l', 0), segment('s2', 'c', 1000)])
  open('s1')
  act(() => result.current.renameLocal('Guest'))
  open('s2')
  act(() => result.current.renameLinkedPerson('Alex'))
  await act(async () => { await result.current.enqueue(async () => {}) })
  expect(result.current.speakerPopover).toBeNull()
  expect(queries.setSpeakerCustomLabel).not.toHaveBeenCalled()
  expect(queries.renamePerson).not.toHaveBeenCalled()
  expect(result.current.history.canUndo).toBe(false)
  expect(toast).not.toHaveBeenCalled()
})

test('a speaker change waiting on the database closes the picker on its segments, never their text', async () => {
  let answer!: () => void
  queries.reassignSegments.mockImplementationOnce((_t: string, changes: { segment_id: string; speaker_id: string | null }[]) =>
    new Promise((resolve) => { answer = () => resolve(changes.map(({ segment_id, speaker_id }) => ({ segment_id, speaker_id }))) }))
  let holds!: { busy: ReadonlyMap<string, unknown>; locked: ReadonlySet<string> }
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalled())
  holds = result.current.holds
  expect(holds.locked.has('s1')).toBe(true)
  expect(holds.busy.has('s1')).toBe(false)
  await act(async () => answer())
})
