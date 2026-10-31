/** @jest-environment node */

import {
  DeleteProjectRequestError,
  deleteProjectRequest,
} from '@/lib/projects/delete-client'

jest.mock('@/infra/workos/access-token', () => ({
  getAccessToken: jest.fn(async () => 'token-for-a'),
  notifyAccountChanged: jest.fn(),
}))

import { ACCOUNT_CHANGED_CODE, AccountChangedError, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'
import { notifyAccountChanged } from '@/infra/workos/access-token'

const fetchMock = jest.fn()

describe('deleteProjectRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = fetchMock
  })

  test('account changes propagate before domain parsing and never count as gone', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: ACCOUNT_CHANGED_CODE, error: 'Account changed', gone: true, stage: 'begin' }, { status: 409 }))
    await expect(deleteProjectRequest('project-1', 'a')).rejects.toBeInstanceOf(AccountChangedError)
    expect(notifyAccountChanged).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get(EXPECTED_USER_HEADER)).toBe('a')
  })

  test('parses a successful response', async () => {
    fetchMock.mockResolvedValue(Response.json({ deleted_projects: 2, deleted_transcripts: 3 }))

    await expect(deleteProjectRequest('project-1', 'a')).resolves.toEqual({
      deleted_projects: 2,
      deleted_transcripts: 3,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/delete', { method: 'POST', headers: expect.any(Headers) })
  })

  test('throws a typed error carrying stage and counts', async () => {
    fetchMock.mockResolvedValue(Response.json({
      error: 'storage failed',
      stage: 'storage',
      removed_media: 4,
      removed_waveforms: 2,
      remaining_transcripts: 7,
    }, { status: 502 }))

    await expect(deleteProjectRequest('project-1', 'a')).rejects.toMatchObject({
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
    fetchMock.mockResolvedValue(Response.json({
      error: 'Project not found',
      stage: 'finish',
      gone: true,
      remaining_transcripts: 0,
    }, { status: 404 }))

    await expect(deleteProjectRequest('project-1', 'a')).rejects.toMatchObject({
      name: 'DeleteProjectRequestError',
      status: 404,
      stage: 'finish',
      gone: true,
      remainingTranscripts: 0,
    } satisfies Partial<DeleteProjectRequestError>)
  })

  test('keeps malformed server responses inside the typed error boundary', async () => {
    const parseError = new SyntaxError('Unexpected token <')
    const response = new Response('<html>unavailable</html>', { status: 504 })
    jest.spyOn(response, 'json').mockRejectedValue(parseError)
    fetchMock.mockResolvedValue(response)

    await expect(deleteProjectRequest('project-1', 'a')).rejects.toMatchObject({
      name: 'DeleteProjectRequestError',
      status: 504,
      stage: null,
      gone: false,
      cause: parseError,
    } satisfies Partial<DeleteProjectRequestError>)
  })
})
