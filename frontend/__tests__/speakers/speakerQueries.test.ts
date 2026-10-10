/** @jest-environment node */

// Marks the file as a module, so `mockRpc` does not collide with other test
// files that declare the same name.
export {}

const mockRpc = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const { setSpeakerCustomLabel, reassignSegments } = jest.requireActual<
  typeof import('@/lib/supabase/queries')
>('@/lib/supabase/queries')

const TRANSCRIPT = '11111111-1111-4111-8111-111111111111'
const SPEAKER = '22222222-2222-4222-8222-222222222222'
const OTHER_SPEAKER = '33333333-3333-4333-8333-333333333333'
const SEGMENT = '44444444-4444-4444-8444-444444444444'

const speakerRow = {
  id: SPEAKER,
  transcript_id: TRANSCRIPT,
  user_id: '55555555-5555-4555-8555-555555555555',
  ordinal: 2,
  custom_label: 'Interviewer',
  diarization_index: null,
  person_id: null,
  created_at: '2026-09-24T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('setSpeakerCustomLabel', () => {
  test('sends the expected label with the new one and returns the saved speaker', async () => {
    mockRpc.mockResolvedValueOnce({ data: speakerRow, error: null })

    await expect(setSpeakerCustomLabel(SPEAKER, 'Host', 'Interviewer')).resolves.toEqual(speakerRow)
    expect(mockRpc).toHaveBeenCalledWith('set_speaker_custom_label', {
      p_speaker_id: SPEAKER,
      p_expected_custom_label: 'Host',
      p_custom_label: 'Interviewer',
    })
  })

  test('passes a guard refusal through to the caller', async () => {
    const conflict = { code: 'SP002', message: 'speaker label changed since it was read' }
    mockRpc.mockResolvedValueOnce({ data: null, error: conflict })

    await expect(setSpeakerCustomLabel(SPEAKER, 'Old', 'New')).rejects.toBe(conflict)
  })

  test('rejects a malformed response', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: SPEAKER }, error: null })

    await expect(setSpeakerCustomLabel(SPEAKER, 'Host', 'X')).rejects.toThrow()
  })
})

describe('reassignSegments', () => {
  test('sends every change and returns the new assignments', async () => {
    const rows = [{ segment_id: SEGMENT, speaker_id: OTHER_SPEAKER }]
    mockRpc.mockResolvedValueOnce({ data: rows, error: null })

    const changes = [{ segment_id: SEGMENT, expected_speaker_id: SPEAKER, speaker_id: OTHER_SPEAKER }]
    await expect(reassignSegments(TRANSCRIPT, changes)).resolves.toEqual(rows)
    expect(mockRpc).toHaveBeenCalledWith('reassign_segments', {
      p_transcript_id: TRANSCRIPT,
      p_changes: changes,
    })
  })

  test('a null target means Unknown speaker', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ segment_id: SEGMENT, speaker_id: null }], error: null })

    await reassignSegments(TRANSCRIPT, [{ segment_id: SEGMENT, expected_speaker_id: SPEAKER, speaker_id: null }])
    expect(mockRpc.mock.calls[0][1].p_changes[0].speaker_id).toBeNull()
  })

  test('refuses to send a malformed change', async () => {
    await expect(
      reassignSegments(TRANSCRIPT, [{ segment_id: 'not-a-uuid', expected_speaker_id: null, speaker_id: null }])
    ).rejects.toThrow()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('passes a guard refusal through to the caller', async () => {
    const conflict = { code: 'SP002', message: 'segment speaker changed since it was read' }
    mockRpc.mockResolvedValueOnce({ data: null, error: conflict })

    await expect(
      reassignSegments(TRANSCRIPT, [{ segment_id: SEGMENT, expected_speaker_id: null, speaker_id: SPEAKER }])
    ).rejects.toBe(conflict)
  })
})
