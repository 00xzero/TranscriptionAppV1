/** @jest-environment node */

// Marks the file as a module, so `mockRpc` does not collide with other test
// files that declare the same name.
export {}

const mockRpc = jest.fn()
jest.mock('@/infra/supabase/client', () => ({ createClient: () => ({ rpc: mockRpc }) }))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const {
  correctSegmentsToPerson, createLocalSpeaker, fetchEditorPeopleContext, renamePerson, undoCreatedPerson,
} = jest.requireActual<typeof import('@/lib/supabase/queries')>('@/lib/supabase/queries')

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const transcriptId = id('1')
const speakerId = id('2')
const personId = id('3')
const segmentId = id('4')
const userId = id('5')
const stamp = '2026-09-24T00:00:00Z'
const speaker = { id: speakerId, transcript_id: transcriptId, user_id: userId,
  ordinal: 0, custom_label: null, diarization_index: null, person_id: personId,
  created_at: stamp, updated_at: stamp }
const person = { id: personId, user_id: userId, name: 'Alex', organisation_id: null,
  preferred_color: '#4F638C', hidden: false, created_at: stamp, updated_at: stamp }

beforeEach(() => mockRpc.mockReset())

test('picker read validates account context', async () => {
  mockRpc.mockResolvedValue({ data: { people: [{ ...person, organisation_name: null,
    other_transcript_count: 2, last_other_title: 'Review', last_other_seen_at: stamp,
    in_project: true }] }, error: null })
  const context = await fetchEditorPeopleContext(transcriptId)
  expect(context.people[0].other_transcript_count).toBe(2)
  expect(mockRpc).toHaveBeenCalledWith('editor_people_context', { p_transcript_id: transcriptId })
})

test('naming locally moves the given segments and validates the result', async () => {
  const local = { ...speaker, person_id: null, custom_label: 'Host' }
  const assignments = [{ segment_id: segmentId, speaker_id: speakerId }]
  mockRpc.mockResolvedValueOnce({ data: { speaker: local, assignments }, error: null })
  const changes = [{ segment_id: segmentId, expected_speaker_id: null }]
  await expect(createLocalSpeaker(transcriptId, 'Host', changes)).resolves.toEqual({ speaker: local, assignments })
  expect(mockRpc).toHaveBeenCalledWith('create_local_speaker', {
    p_transcript_id: transcriptId, p_custom_label: 'Host', p_changes: changes,
  })
  mockRpc.mockResolvedValueOnce({ data: { speaker: local }, error: null })
  await expect(createLocalSpeaker(transcriptId, 'Host', changes)).rejects.toThrow()
})

test('a refused write reaches the caller with its SQLSTATE', async () => {
  const conflict = { code: 'SP002', message: 'person name changed since it was read' }
  mockRpc.mockResolvedValue({ data: null, error: conflict })
  await expect(renamePerson(personId, 'Alex', 'Alexa')).rejects.toBe(conflict)
  expect(mockRpc).toHaveBeenCalledWith('rename_person_guarded', {
    p_person_id: personId, p_expected_name: 'Alex', p_name: 'Alexa',
  })
})

test('a correction to an existing or new person is one RPC', async () => {
  mockRpc.mockResolvedValue({ data: { speaker, person,
    assignments: [{ segment_id: segmentId, speaker_id: speakerId }] }, error: null })
  const changes = [{ segment_id: segmentId, expected_speaker_id: null }]
  await correctSegmentsToPerson(transcriptId, changes, { personId })
  expect(mockRpc).toHaveBeenLastCalledWith('correct_segments_to_person', {
    p_transcript_id: transcriptId, p_changes: changes, p_person_id: personId, p_new_person_name: null,
  })
  await correctSegmentsToPerson(transcriptId, changes, { newPersonName: 'Alex' })
  expect(mockRpc).toHaveBeenLastCalledWith('correct_segments_to_person', {
    p_transcript_id: transcriptId, p_changes: changes, p_person_id: null, p_new_person_name: 'Alex',
  })
  expect(mockRpc).toHaveBeenCalledTimes(2)
})

test('creation Undo sends row versions and assignment guards', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null })
  const changes = [{ segment_id: segmentId, expected_speaker_id: speakerId, speaker_id: null }]
  await undoCreatedPerson({ transcriptId, speakerId, person, changes })
  expect(mockRpc).toHaveBeenCalledWith('undo_created_person_action', {
    p_transcript_id: transcriptId, p_person_id: personId, p_person_updated_at: stamp, p_speaker_id: speakerId,
    p_changes: changes,
  })
})
