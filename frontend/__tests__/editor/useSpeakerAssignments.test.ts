import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { useSpeakerAssignments } from '../../app/editor/[id]/hooks/useSpeakerAssignments'
import { SPEAKER_COLORS } from '@/lib/speakers/palette'
import type { EditorPeopleContext, EditorPerson, Speaker } from '@/contracts/db'
import type { Seg } from '../../app/editor/[id]/types'

jest.mock('@/lib/supabase/queries', () => ({
  reassignSegments: jest.fn(),
  setSpeakerCustomLabel: jest.fn(),
  createLocalSpeaker: jest.fn(),
  correctSegmentsToPerson: jest.fn(),
  renamePerson: jest.fn(),
  undoCreatedPerson: jest.fn(),
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
  is_edited: false, is_filler: false, algo_version: 'test', created_at: stamp, updated_at: stamp,
})
const alex: EditorPerson = {
  id: 'p1', user_id: 'u1', name: 'Alex', organisation_id: null, organisation_name: null,
  preferred_color: SPEAKER_COLORS[0], hidden: false, created_at: stamp, updated_at: stamp,
  other_transcript_count: 1, last_other_title: null, last_other_seen_at: null, in_project: false,
}
const context: EditorPeopleContext = { people: [alex] }
const anchor = { getBoundingClientRect: () => new DOMRect() }
const alexHere = named('c', 3, { custom_label: null, person_id: 'p1' })

function setup(initialSpeakers = [detected('a', 0), detected('b', 1)],
  initialSegments = [segment('s1', 'a', 0), segment('s2', 'a', 1000)]) {
  queries.fetchSegmentSpeakerAssignments.mockResolvedValue([])
  queries.fetchSpeakers.mockResolvedValue(initialSpeakers)
  queries.fetchEditorPeopleContext.mockResolvedValue(context)
  const rendered = renderHook(() => {
    const [speakers, setSpeakers] = useState(initialSpeakers)
    const [segments, setSegments] = useState(initialSegments)
    const [peopleContext, setPeopleContext] = useState(context)
    const hook = useSpeakerAssignments({ transcriptId: 't1', speakers, segments, peopleContext,
      setSpeakers, setSegments, setPeopleContext })
    return { ...hook, segments, speakers, peopleContext }
  })
  const open = (id = 's1') => act(() => rendered.result.current.setSpeakerPopover({
    segmentId: id,
    speakerId: rendered.result.current.segments.find((row) => row.id === id)!.speaker_id,
    anchorMeasurable: anchor, triggerElement: null,
  }))
  const speakerIds = () => rendered.result.current.segments.map((row) => row.speaker_id)
  return { ...rendered, open, speakerIds }
}

const toastWith = (label: string) => toast.mock.calls
  .map(([options]: [{ action?: { label: string; onClick: () => void } }]) => options)
  .find((options: { action?: { label: string } }) => options.action?.label === label)

beforeEach(() => {
  jest.clearAllMocks()
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
    segment_id: 's1', expected_speaker_id: 'c', speaker_id: null,
  }])
  expect(toastWith('Undo')!.title).toBe('Removed Alex from this segment — back to Unknown speaker')
  act(() => toastWith('Undo')!.action!.onClick())
  await waitFor(() => expect(speakerIds()).toEqual(['c']))
})

test('a passage correction settles on the speaker the database chose', async () => {
  queries.correctSegmentsToPerson.mockResolvedValue({ speaker: alexHere, person: alex,
    assignments: [{ segment_id: 's1', speaker_id: 'c' }] })
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'person', id: 'p1' }, 'segment'))
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'a']))
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1',
    [{ segment_id: 's1', expected_speaker_id: 'a' }], { personId: 'p1' })
  expect(result.current.speakers.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Moved this segment to Alex' }))
  expect(queries.fetchSpeakers).not.toHaveBeenCalled()
})

test('a continuous turn sends every segment showing the identity', async () => {
  const { result, open } = setup()
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'turn'))
  await waitFor(() => expect(queries.reassignSegments).toHaveBeenCalledTimes(1))
  expect(queries.reassignSegments.mock.calls[0][1]).toEqual([
    { segment_id: 's1', expected_speaker_id: 'a', speaker_id: 'b' },
    { segment_id: 's2', expected_speaker_id: 'a', speaker_id: 'b' },
  ])
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
  await waitFor(() => expect(toastWith('Undo')).toBeDefined())
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'a' }, { segment_id: 's2', expected_speaker_id: 'a' },
  ], { personId: 'p1' })
  expect(toastWith('Undo')).toMatchObject({ title: 'Identified Speaker 1 as Alex', durationMs: 8000 })
  expect(result.current.labelForSpeaker(speakerIds()[0])).toBe('Alex')
  // Deepgram's speaker keeps no name of its own.
  expect(result.current.speakers[0]).toMatchObject({ id: 'a', person_id: null, custom_label: null })
  act(() => toastWith('Undo')!.action!.onClick())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'c', speaker_id: 'a' },
    { segment_id: 's2', expected_speaker_id: 'c', speaker_id: 'a' },
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

test('naming a detected speaker in this transcript moves its segments to a new local speaker', async () => {
  const host = named('l', 3, { custom_label: 'Host', person_id: null })
  queries.createLocalSpeaker.mockResolvedValueOnce({ speaker: host,
    assignments: [{ segment_id: 's1', speaker_id: 'l' }, { segment_id: 's2', speaker_id: 'l' }] })
  const { result, open, speakerIds } = setup()
  open()
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(toastWith('Undo')).toBeDefined())
  expect(queries.createLocalSpeaker).toHaveBeenCalledWith('t1', 'Host', [
    { segment_id: 's1', expected_speaker_id: 'a' }, { segment_id: 's2', expected_speaker_id: 'a' },
  ])
  expect(toastWith('Undo')!.title).toBe('Renamed Speaker 1 to Host in this transcript')
  expect(speakerIds()).toEqual(['l', 'l'])
  act(() => toastWith('Undo')!.action!.onClick())
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a']))
})

test('a local label write uses its old value as guard, and Undo the saved one', async () => {
  const guest = named('l', 3, { custom_label: 'Guest', person_id: null })
  queries.setSpeakerCustomLabel
    .mockResolvedValueOnce({ ...guest, custom_label: 'Host' })
    .mockResolvedValueOnce(guest)
  const { result, open } = setup([detected('a', 0), guest], [segment('s1', 'l', 0)])
  open()
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(toastWith('Undo')).toBeDefined())
  expect(queries.setSpeakerCustomLabel).toHaveBeenCalledWith('l', 'Guest', 'Host')
  expect(toastWith('Undo')!.title).toBe('Renamed Guest to Host in this transcript')
  act(() => toastWith('Undo')!.action!.onClick())
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
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({
    title: 'Removed Alex from this segment — back to Speaker 1' }))
  open('s1')
  act(() => result.current.removeSpeaker('speaker'))
  await waitFor(() => expect(speakerIds()).toEqual(['a', 'a', 'a']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1', [
    { segment_id: 's1', expected_speaker_id: 'c', speaker_id: 'a' },
    { segment_id: 's3', expected_speaker_id: 'c', speaker_id: 'a' },
  ])
  expect(result.current.presentation.identities.map((identity) => identity.label)).toEqual(['Speaker 1'])
})

test('Removing a name from segments Deepgram split sends each to its own speaker', async () => {
  const { result, open, speakerIds } = setup([detected('a', 0), detected('b', 1), alexHere],
    [segment('s1', 'c', 0, 0), segment('s2', 'c', 1000, 1)])
  open()
  act(() => result.current.removeSpeaker('speaker'))
  await waitFor(() => expect(toastWith('Undo')).toBeDefined())
  expect(toastWith('Undo')!.title).toBe('Removed Alex')
  expect(speakerIds()).toEqual(['a', 'b'])
  act(() => toastWith('Undo')!.action!.onClick())
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
})

test('refreshes speaker data when the tab regains focus', async () => {
  setup()
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(queries.fetchSpeakers).toHaveBeenCalledTimes(1))
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
  await waitFor(() => expect(toastWith('Undo')).toBeDefined())
  expect(queries.correctSegmentsToPerson).toHaveBeenCalledWith('t1', expect.any(Array), { newPersonName: 'Blair' })
  expect(result.current.peopleContext.people.find((person) => person.id === 'created')?.organisation_name).toBeNull()
  act(() => toastWith('Undo')!.action!.onClick())
  await waitFor(() => expect(queries.undoCreatedPerson).toHaveBeenCalledWith({
    transcriptId: 't1', speakerId: 'c', person: expect.objectContaining({ id: 'created', updated_at: createdPerson.updated_at }),
    changes: [
      { segment_id: 's1', expected_speaker_id: 'c', speaker_id: 'a' },
      { segment_id: 's2', expected_speaker_id: 'c', speaker_id: 'a' },
    ],
  }))
  await waitFor(() => expect(result.current.peopleContext.people.map((person) => person.id)).toEqual(['p1']))
  expect(speakerIds()).toEqual(['a', 'a'])
  expect(result.current.speakers.find((row) => row.id === 'c')?.person_id).toBeNull()
})

test('an open picker closes when a refresh moves its segment to another speaker', async () => {
  const { result, open } = setup()
  open()
  queries.fetchSegmentSpeakerAssignments.mockResolvedValueOnce([{ id: 's1', speaker_id: 'b' }])
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
  await waitFor(() => expect(speakerIds()[0]).toMatch(/^pending-/))
  open('s2')
  const host = named('l', 3, { custom_label: 'Host', person_id: null })
  await act(async () => save({ speaker: host,
    assignments: [{ segment_id: 's1', speaker_id: 'l' }, { segment_id: 's2', speaker_id: 'l' }] }))
  expect(speakerIds()).toEqual(['l', 'l'])
  expect(result.current.speakerPopover).not.toBeNull()
  expect(result.current.currentSpeaker?.id).toBe('l')
})

test('a person picked while their creation is still saving is written under their saved id', async () => {
  let save!: (value: unknown) => void
  const blair = { ...alex, id: 'created', name: 'Blair' }
  const blairHere = named('c', 3, { custom_label: null, person_id: 'created' })
  queries.correctSegmentsToPerson
    .mockImplementationOnce(() => new Promise((resolve) => { save = resolve }))
    .mockResolvedValueOnce({ speaker: blairHere, person: blair, assignments: [{ segment_id: 's2', speaker_id: 'c' }] })
  const { result, open, speakerIds } = setup()
  open('s1')
  act(() => result.current.selectTarget({ kind: 'new-person', name: 'Blair' }, 'segment'))
  await waitFor(() => expect(result.current.peopleContext.people.map((person) => person.name)).toContain('Blair'))
  const provisionalId = result.current.peopleContext.people.find((person) => person.name === 'Blair')!.id
  open('s2')
  act(() => result.current.selectTarget({ kind: 'person', id: provisionalId }, 'segment'))
  await act(async () => save({ speaker: blairHere, person: blair, assignments: [{ segment_id: 's1', speaker_id: 'c' }] }))
  await waitFor(() => expect(speakerIds()).toEqual(['c', 'c']))
  expect(queries.correctSegmentsToPerson).toHaveBeenLastCalledWith('t1',
    [{ segment_id: 's2', expected_speaker_id: 'a' }], { personId: 'created' })
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Moved this segment to Blair' }))
})

test('a local speaker picked while it is still saving is written under its saved id', async () => {
  let save!: (value: unknown) => void
  queries.createLocalSpeaker.mockImplementationOnce(() => new Promise((resolve) => { save = resolve }))
  const { result, open, speakerIds } = setup([detected('a', 0), detected('b', 1)],
    [segment('s1', 'a', 0), segment('s2', 'b', 1000, 1)])
  open('s1')
  act(() => result.current.renameLocal('Host'))
  await waitFor(() => expect(speakerIds()[0]).toMatch(/^pending-/))
  const provisionalId = speakerIds()[0]!
  open('s2')
  act(() => result.current.selectTarget({ kind: 'speaker', id: provisionalId }, 'segment'))
  await act(async () => save({ speaker: named('l', 3, { custom_label: 'Host', person_id: null }),
    assignments: [{ segment_id: 's1', speaker_id: 'l' }] }))
  await waitFor(() => expect(speakerIds()).toEqual(['l', 'l']))
  expect(queries.reassignSegments).toHaveBeenLastCalledWith('t1',
    [{ segment_id: 's2', expected_speaker_id: 'b', speaker_id: 'l' }])
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Moved this segment to Host' }))
})

test('a refused write whose refresh fails says so, and offers to refresh again', async () => {
  queries.reassignSegments.mockRejectedValueOnce({ code: 'SP002' })
  const { result, open, speakerIds } = setup()
  queries.fetchSpeakers.mockRejectedValueOnce(new Error('offline'))
  jest.spyOn(console, 'error').mockImplementationOnce(() => {})
  open()
  act(() => result.current.selectTarget({ kind: 'speaker', id: 'b' }, 'segment'))
  await waitFor(() => expect(toastWith('Retry')).toBeDefined())
  expect(toastWith('Retry')!.title).toBe("Changed in another tab — couldn't refresh")
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed in another tab — refreshed' }))
  expect(speakerIds()).toEqual(['a', 'a'])
  act(() => toastWith('Retry')!.action!.onClick())
  await waitFor(() => expect(toast).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Changed in another tab — refreshed' })))
})
