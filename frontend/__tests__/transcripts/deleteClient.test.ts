/** @jest-environment node */

import {
  DeleteTranscriptRequestError,
  deleteTranscriptRequest,
} from '@/lib/transcripts/delete-client'

jest.mock('@/infra/workos/access-token', () => ({
  getAccessToken: jest.fn(async () => 'token-for-a'),
  notifyAccountChanged: jest.fn(),
}))

import { ACCOUNT_CHANGED_CODE, AccountChangedError, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'
import { notifyAccountChanged } from '@/infra/workos/access-token'

const fetchMock = jest.fn()

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue(Response.json(body, { status }))
}

describe('deleteTranscriptRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock
  })

  test('account changes propagate before domain parsing and never count as gone', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: ACCOUNT_CHANGED_CODE, error: 'Account changed', gone: true, stage: 'begin' }, { status: 409 }))
    await expect(deleteTranscriptRequest('transcript-1', 'a')).rejects.toBeInstanceOf(AccountChangedError)
    expect(notifyAccountChanged).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get(EXPECTED_USER_HEADER)).toBe('a')
  })

  test('resolves once the transcript is deleted', async () => {
    respond(200, { deleted: true })

    await expect(deleteTranscriptRequest('transcript-1', 'a')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/transcripts/transcript-1/delete', { method: 'POST', headers: expect.any(Headers) })
  })

  test('treats an already-deleted transcript as done', async () => {
    respond(404, { error: 'Transcript not found', gone: true })

    await expect(deleteTranscriptRequest('transcript-1', 'a')).resolves.toBeUndefined()
  })

  test('throws a typed error carrying the route message and status', async () => {
    respond(409, { error: 'The transcript changed while it was being deleted. Try again.' })

    const error = await deleteTranscriptRequest('transcript-1', 'a').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DeleteTranscriptRequestError)
    expect(error).toMatchObject({
      status: 409,
      message: 'The transcript changed while it was being deleted. Try again.',
    })
  })

  test('rejects a success body that does not match the contract', async () => {
    respond(200, { deleted_projects: 1 })

    await expect(deleteTranscriptRequest('transcript-1', 'a')).rejects.toBeInstanceOf(
      DeleteTranscriptRequestError
    )
  })

  test('rejects a response that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      clone: () => new Response('unavailable', { status: 502 }),
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(deleteTranscriptRequest('transcript-1', 'a')).rejects.toMatchObject({ status: 502 })
  })
})
