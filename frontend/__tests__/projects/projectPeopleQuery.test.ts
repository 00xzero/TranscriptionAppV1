/** @jest-environment node */

export {}

const mockRpc = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const { fetchProjectPeople } = jest.requireActual<
  typeof import('@/lib/supabase/queries')
>('@/lib/supabase/queries')

const PROJECT = '33333333-3333-4333-8333-333333333333'
const PERSON = '11111111-1111-4111-8111-111111111111'
const TRANSCRIPT = '22222222-2222-4222-8222-222222222222'
const VOICE = '55555555-5555-4555-8555-555555555555'

const answer = {
  people: [{
    id: PERSON, name: 'Ada', preferred_color: '#0D9488', organisation_name: 'Example Org', hidden: false,
    transcript_count: 2, talk_ms: 4500, last_seen_at: '2026-09-02T00:00:00+00:00',
  }],
  voices: [{
    transcript_id: TRANSCRIPT, title: 'T1', project_id: PROJECT, created_at: '2026-09-01T00:00:00+00:00',
    voice_ids: [VOICE],
    peers: [{ id: VOICE, ordinal: 1, customLabel: null, personId: null, personName: null, organisationName: null }],
  }],
}

describe('fetchProjectPeople', () => {
  beforeEach(() => jest.clearAllMocks())

  test('calls project_people for the project and returns the parsed answer', async () => {
    mockRpc.mockResolvedValueOnce({ data: answer, error: null })

    await expect(fetchProjectPeople(PROJECT)).resolves.toEqual(answer)
    expect(mockRpc).toHaveBeenCalledWith('project_people', { p_project_id: PROJECT })
  })

  test('throws the database error', async () => {
    const error = { code: 'SP001', message: 'project not found' }
    mockRpc.mockResolvedValueOnce({ data: null, error })

    await expect(fetchProjectPeople(PROJECT)).rejects.toBe(error)
  })

  test('refuses a malformed answer rather than showing half of it', async () => {
    mockRpc.mockResolvedValueOnce({ data: { people: [{ id: PERSON }], voices: [] }, error: null })

    await expect(fetchProjectPeople(PROJECT)).rejects.toThrow()
  })
})
