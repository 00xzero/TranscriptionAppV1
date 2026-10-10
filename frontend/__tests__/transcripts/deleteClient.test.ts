import {
  DeleteTranscriptRequestError,
  deleteTranscriptRequest,
} from '@/lib/transcripts/delete-client'

const fetchMock = jest.fn()

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('deleteTranscriptRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock
  })

  test('resolves once the transcript is deleted', async () => {
    respond(200, { deleted: true })

    await expect(deleteTranscriptRequest('transcript-1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/transcripts/transcript-1/delete', { method: 'POST' })
  })

  test('treats an already-deleted transcript as done', async () => {
    respond(404, { error: 'Transcript not found', gone: true })

    await expect(deleteTranscriptRequest('transcript-1')).resolves.toBeUndefined()
  })

  test('throws a typed error carrying the route message and status', async () => {
    respond(409, { error: 'The transcript changed while it was being deleted. Try again.' })

    const error = await deleteTranscriptRequest('transcript-1').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DeleteTranscriptRequestError)
    expect(error).toMatchObject({
      status: 409,
      message: 'The transcript changed while it was being deleted. Try again.',
    })
  })

  test('rejects a success body that does not match the contract', async () => {
    respond(200, { deleted_projects: 1 })

    await expect(deleteTranscriptRequest('transcript-1')).rejects.toBeInstanceOf(
      DeleteTranscriptRequestError
    )
  })

  test('rejects a response that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(deleteTranscriptRequest('transcript-1')).rejects.toMatchObject({ status: 502 })
  })
})
