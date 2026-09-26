/** @jest-environment node */

// Marks the file as a module. Without it TS treats these test files as scripts
// sharing one global scope, and `mockRpc` collides with projects/queries.test.ts.
export {}

const mockRpc = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}))

// jest.setup.ts globally mocks this module, so reach past it for the real code.
const { fetchProjectSpeakerSummaries } = jest.requireActual<
  typeof import('@/lib/supabase/queries')
>('@/lib/supabase/queries')

const row = (projectId: string, speakerCount: number, preview: unknown[] = []) => ({
  project_id: projectId,
  speaker_count: speakerCount,
  preview,
})

const speaker = {
  id: '11111111-1111-1111-1111-111111111111',
  transcriptId: '22222222-2222-2222-2222-222222222222',
  ordinal: 0,
  customLabel: 'Kate',
  personName: null,
  personColor: null,
}

const PROJECT_A = '33333333-3333-3333-3333-333333333333'
const PROJECT_B = '44444444-4444-4444-4444-444444444444'

describe('fetchProjectSpeakerSummaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('calls the RPC once with every project id and the scope flag', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null })

    await fetchProjectSpeakerSummaries([PROJECT_A, PROJECT_B], { includeDescendants: true })

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('project_speaker_summaries', {
      p_project_ids: [PROJECT_A, PROJECT_B],
      p_include_descendants: true,
      p_preview_limit: 4,
    })
  })

  test('passes the direct scope and an explicit preview limit', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null })

    await fetchProjectSpeakerSummaries([PROJECT_A], {
      includeDescendants: false,
      previewLimit: 2,
    })

    expect(mockRpc).toHaveBeenCalledWith('project_speaker_summaries', {
      p_project_ids: [PROJECT_A],
      p_include_descendants: false,
      p_preview_limit: 2,
    })
  })

  test('short-circuits an empty request without touching the network', async () => {
    await expect(
      fetchProjectSpeakerSummaries([], { includeDescendants: true })
    ).resolves.toEqual(new Map())

    expect(mockRpc).not.toHaveBeenCalled()
  })

  test('keys the result by project id', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [row(PROJECT_A, 1, [speaker]), row(PROJECT_B, 0)],
      error: null,
    })

    const result = await fetchProjectSpeakerSummaries([PROJECT_A, PROJECT_B], {
      includeDescendants: true,
    })

    expect(result.size).toBe(2)
    expect(result.get(PROJECT_A)?.speaker_count).toBe(1)
    expect(result.get(PROJECT_A)?.preview[0]).toEqual(speaker)
    // Present with a zero count is meaningfully different from absent.
    expect(result.get(PROJECT_B)?.speaker_count).toBe(0)
  })

  test('omits a project the RPC did not return, rather than inventing a zero', async () => {
    mockRpc.mockResolvedValueOnce({ data: [row(PROJECT_A, 2)], error: null })

    const result = await fetchProjectSpeakerSummaries([PROJECT_A, PROJECT_B], {
      includeDescendants: true,
    })

    // PROJECT_B is not the caller's, or is being deleted — the surface must be
    // able to tell that apart from "no speakers yet".
    expect(result.has(PROJECT_B)).toBe(false)
  })

  test('treats a null payload as no summaries', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(
      fetchProjectSpeakerSummaries([PROJECT_A], { includeDescendants: true })
    ).resolves.toEqual(new Map())
  })

  test('throws the RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('permission denied') })

    await expect(
      fetchProjectSpeakerSummaries([PROJECT_A], { includeDescendants: true })
    ).rejects.toThrow('permission denied')
  })

  describe('rejects a malformed response rather than rendering it', () => {
    test.each([
      ['a preview that is not an array', [{ ...row(PROJECT_A, 1), preview: null }]],
      ['a missing count', [{ project_id: PROJECT_A, preview: [] }]],
      ['a negative count', [row(PROJECT_A, -1)]],
      ['a non-uuid project id', [row('not-a-uuid', 0)]],
      ['a preview entry without its person fields', [
        row(PROJECT_A, 1, [{ ...speaker, personName: undefined }]),
      ]],
      ['an object where rows were expected', { project_id: PROJECT_A }],
    ])('%s', async (_label, data) => {
      mockRpc.mockResolvedValueOnce({ data, error: null })

      await expect(
        fetchProjectSpeakerSummaries([PROJECT_A], { includeDescendants: true })
      ).rejects.toThrow('Malformed project_speaker_summaries response')
    })
  })
})
