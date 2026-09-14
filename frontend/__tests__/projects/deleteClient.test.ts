import {
  DeleteProjectRequestError,
  deleteProjectRequest,
} from '@/lib/projects/delete-client'

const fetchMock = jest.fn()

describe('deleteProjectRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock
  })

  test('parses a successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deleted_projects: 2, deleted_transcripts: 3 }),
    })

    await expect(deleteProjectRequest('project-1')).resolves.toEqual({
      deleted_projects: 2,
      deleted_transcripts: 3,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/delete', { method: 'POST' })
  })

  test('throws a typed error carrying stage and counts', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: 'storage failed',
        stage: 'storage',
        removed_media: 4,
        removed_waveforms: 2,
        remaining_transcripts: 7,
      }),
    })

    await expect(deleteProjectRequest('project-1')).rejects.toMatchObject({
      name: 'DeleteProjectRequestError',
      status: 502,
      stage: 'storage',
      removedMedia: 4,
      removedWaveforms: 2,
      remainingTranscripts: 7,
      gone: false,
    } satisfies Partial<DeleteProjectRequestError>)
  })

  test('exposes gone for an already-completed finish', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'Project not found',
        stage: 'finish',
        gone: true,
        remaining_transcripts: 0,
      }),
    })

    await expect(deleteProjectRequest('project-1')).rejects.toMatchObject({
      name: 'DeleteProjectRequestError',
      status: 404,
      stage: 'finish',
      gone: true,
      remainingTranscripts: 0,
    } satisfies Partial<DeleteProjectRequestError>)
  })

  test('keeps malformed server responses inside the typed error boundary', async () => {
    const parseError = new SyntaxError('Unexpected token <')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => { throw parseError },
    })

    await expect(deleteProjectRequest('project-1')).rejects.toMatchObject({
      name: 'DeleteProjectRequestError',
      status: 504,
      stage: null,
      gone: false,
      cause: parseError,
    } satisfies Partial<DeleteProjectRequestError>)
  })
})
