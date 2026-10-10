/** @jest-environment node */

// Marks the file as a module, so `mockRpc` does not collide with other test
// files that declare the same name.
export {}

const mockRpc = jest.fn()
jest.mock('@/infra/supabase/client', () => ({ createClient: () => ({ rpc: mockRpc }) }))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const {
  createPerson, deleteOrganisation, deletePerson, fetchMergePreview, fetchPeopleDirectory, fetchPersonAppearances,
  mergePeople, removePersonFromTranscript, renameOrganisation, setPersonColor, setPersonHidden, setPersonOrganisation,
} = jest.requireActual<typeof import('@/lib/supabase/queries')>('@/lib/supabase/queries')

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const personId = id('1')
const otherId = id('2')
const organisationId = id('3')
const transcriptId = id('4')
const segmentId = id('5')
const speakerId = id('6')
const userId = id('7')
const stamp = '2026-09-26T00:00:00+00:00'
const person = { id: personId, user_id: userId, name: 'Alex', organisation_id: null,
  preferred_color: '#4F638C', hidden: false, created_at: stamp, updated_at: stamp }
const organisation = { id: organisationId, user_id: userId, name: 'Example Org', created_at: stamp, updated_at: stamp }
const metadata = { person_id: personId, name: 'Alex', preferred_color: '#4F638C',
  organisation_id: null, organisation_name: null }
const mergePreview = () => ({ survivor: { ...metadata }, survivor_transcript_ids: [transcriptId], people: [{
  ...metadata, person_id: otherId, transcripts: [{
    transcript_id: transcriptId, title: 'Review', created_at: stamp,
    voices: [{ speaker_id: speakerId, custom_label: null, talk_ms: 12_500, detected_ordinals: [1, null] }],
  }],
}] })

beforeEach(() => mockRpc.mockReset())

test('the directory read validates people and organisations', async () => {
  mockRpc.mockResolvedValue({ data: {
    people: [{ ...person, organisation_name: null, transcript_count: 3, last_seen_at: stamp }],
    organisations: [{ ...organisation, person_count: 0 }],
  }, error: null })
  const directory = await fetchPeopleDirectory()
  expect(directory.people[0].transcript_count).toBe(3)
  expect(mockRpc).toHaveBeenCalledWith('people_directory')

  mockRpc.mockResolvedValue({ data: { people: [person], organisations: [] }, error: null })
  await expect(fetchPeopleDirectory()).rejects.toThrow()
})

test('appearances and the merge preview are read for the given people', async () => {
  const appearance = { transcript_id: transcriptId, title: null, project_id: null, created_at: stamp,
    talk_ms: 90_000, transcript_talk_ms: 600_000 }
  mockRpc.mockResolvedValueOnce({ data: [appearance], error: null })
  await expect(fetchPersonAppearances(personId)).resolves.toEqual([appearance])
  expect(mockRpc).toHaveBeenLastCalledWith('list_person_appearances', { p_person_id: personId })
  // Speaking time replaced the segment count.
  mockRpc.mockResolvedValueOnce({ data: [{ transcript_id: transcriptId, title: null, project_id: null,
    created_at: stamp, segment_count: 4 }], error: null })
  await expect(fetchPersonAppearances(personId)).rejects.toThrow()

  const preview = mergePreview()
  mockRpc.mockResolvedValueOnce({ data: preview, error: null })
  await expect(fetchMergePreview(personId, [otherId])).resolves.toEqual(preview)
  expect(mockRpc).toHaveBeenLastCalledWith('merge_people_preview', { p_survivor_id: personId, p_person_ids: [otherId] })
})

test('the parsed preview reaches merge unchanged', async () => {
  const preview = mergePreview()
  mockRpc.mockResolvedValueOnce({ data: preview, error: null })
  const parsed = await fetchMergePreview(personId, [otherId])
  mockRpc.mockResolvedValueOnce({ data: person, error: null })
  await mergePeople(personId, [otherId], parsed)
  expect(mockRpc).toHaveBeenLastCalledWith('merge_people', {
    p_survivor_id: personId, p_person_ids: [otherId], p_expected_preview: preview,
  })
})

test.each([
  ['preview', (preview: ReturnType<typeof mergePreview>) => preview],
  ['survivor', (preview: ReturnType<typeof mergePreview>) => preview.survivor],
  ['person', (preview: ReturnType<typeof mergePreview>) => preview.people[0]],
  ['transcript', (preview: ReturnType<typeof mergePreview>) => preview.people[0].transcripts[0]],
  ['voice', (preview: ReturnType<typeof mergePreview>) => preview.people[0].transcripts[0].voices[0]],
])('unknown fields in the %s fail when loading the preview', async (_level, select) => {
  const preview = mergePreview()
  Object.assign(select(preview), { future_field: 'unexpected' })
  mockRpc.mockResolvedValueOnce({ data: preview, error: null })
  await expect(fetchMergePreview(personId, [otherId])).rejects.toMatchObject({
    issues: expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]),
  })
  expect(mockRpc).toHaveBeenCalledTimes(1)
})

test('each write is one guarded RPC with the values it expects to replace', async () => {
  mockRpc.mockResolvedValue({ data: person, error: null })
  await createPerson('Alex')
  expect(mockRpc).toHaveBeenLastCalledWith('create_person', { p_name: 'Alex' })
  await setPersonColor(personId, '#4F638C', '#C73E1D')
  expect(mockRpc).toHaveBeenLastCalledWith('set_person_color', {
    p_person_id: personId, p_expected_color: '#4F638C', p_color: '#C73E1D' })
  await setPersonHidden(personId, true)
  expect(mockRpc).toHaveBeenLastCalledWith('set_person_hidden', { p_person_id: personId, p_hidden: true })
  // Merge keeps the order the people were picked in.
  const preview = { survivor: metadata, survivor_transcript_ids: [], people: [] }
  await mergePeople(personId, [otherId, organisationId], preview)
  expect(mockRpc).toHaveBeenLastCalledWith('merge_people', {
    p_survivor_id: personId, p_person_ids: [otherId, organisationId], p_expected_preview: preview })

  mockRpc.mockResolvedValue({ data: organisation, error: null })
  await renameOrganisation(organisationId, 'Example', 'Example Org')
  expect(mockRpc).toHaveBeenLastCalledWith('rename_organisation', {
    p_organisation_id: organisationId, p_expected_name: 'Example', p_name: 'Example Org' })

  mockRpc.mockResolvedValue({ data: null, error: null })
  await deletePerson(personId)
  expect(mockRpc).toHaveBeenLastCalledWith('delete_person', { p_person_id: personId })
  await deleteOrganisation(organisationId)
  expect(mockRpc).toHaveBeenLastCalledWith('delete_organisation', { p_organisation_id: organisationId })
})

test('an organisation is set by id, by a new name, or cleared', async () => {
  mockRpc.mockResolvedValue({ data: { person: { ...person, organisation_id: organisationId }, organisation }, error: null })
  await setPersonOrganisation(personId, null, { organisationId })
  expect(mockRpc).toHaveBeenLastCalledWith('set_person_organisation', {
    p_person_id: personId, p_expected_organisation_id: null, p_organisation_id: organisationId, p_new_organisation_name: null })
  await setPersonOrganisation(personId, null, { newOrganisationName: 'Example Org' })
  expect(mockRpc).toHaveBeenLastCalledWith('set_person_organisation', {
    p_person_id: personId, p_expected_organisation_id: null, p_organisation_id: null, p_new_organisation_name: 'Example Org' })

  mockRpc.mockResolvedValue({ data: { person, organisation: null }, error: null })
  await expect(setPersonOrganisation(personId, organisationId, null)).resolves.toEqual({ person, organisation: null })
  expect(mockRpc).toHaveBeenLastCalledWith('set_person_organisation', {
    p_person_id: personId, p_expected_organisation_id: organisationId, p_organisation_id: null, p_new_organisation_name: null })
})

test('remove returns the changes it made, for Undo', async () => {
  const changes = [{ segment_id: segmentId, expected_speaker_id: speakerId, speaker_id: null }]
  mockRpc.mockResolvedValue({ data: changes, error: null })
  await expect(removePersonFromTranscript(personId, transcriptId)).resolves.toEqual(changes)
  expect(mockRpc).toHaveBeenCalledWith('remove_person_from_transcript', {
    p_person_id: personId, p_transcript_id: transcriptId })
})

test('a refused write reaches the caller with its SQLSTATE', async () => {
  const conflict = { code: 'SP002', message: 'person still appears in a transcript' }
  mockRpc.mockResolvedValue({ data: null, error: conflict })
  await expect(deletePerson(personId)).rejects.toBe(conflict)
  await expect(removePersonFromTranscript(personId, transcriptId)).rejects.toBe(conflict)
})
