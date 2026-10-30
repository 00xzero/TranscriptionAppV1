/** @jest-environment node */

import { accountBoundFetch } from '@/lib/auth/account-bound-fetch'
import { getAccessToken, notifyAccountChanged } from '@/infra/workos/access-token'
import { ACCOUNT_CHANGED_CODE, AccountChangedError, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

jest.mock('@/infra/workos/access-token', () => ({
  getAccessToken: jest.fn(),
  notifyAccountChanged: jest.fn(),
}))

const getToken = jest.mocked(getAccessToken)
const PATH = '/api/transcripts'

beforeEach(() => {
  jest.clearAllMocks()
  getToken.mockResolvedValue('token-for-a')
  jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ ok: true }))
})
afterEach(() => jest.restoreAllMocks())

test.each([
  { 'content-type': 'application/json', [EXPECTED_USER_HEADER]: 'b' },
  [['content-type', 'application/json'], [EXPECTED_USER_HEADER, 'b']],
  new Headers({ 'content-type': 'application/json', [EXPECTED_USER_HEADER]: 'b' }),
] as HeadersInit[])('merges caller headers and binds the request to its original account (%#)', async (headers) => {
  const onDispatch = jest.fn()
  const controller = new AbortController()
  const response = Response.json({ created: true })
  jest.mocked(fetch).mockImplementation(async (_path, init) => {
    expect(onDispatch).toHaveBeenCalledTimes(1)
    expect(new Headers(init?.headers).get(EXPECTED_USER_HEADER)).toBe('a')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(init).toMatchObject({ method: 'POST', body: '{}', signal: controller.signal, credentials: 'same-origin' })
    return response
  })

  expect(await accountBoundFetch(PATH, {
    method: 'POST', headers, body: '{}', signal: controller.signal, credentials: 'same-origin',
  }, 'a', onDispatch)).toBe(response)
  expect(getToken).toHaveBeenCalledWith('a')
  expect(await response.json()).toEqual({ created: true })
})

test('an empty owner or failed preflight never dispatches', async () => {
  const onDispatch = jest.fn()
  await expect(accountBoundFetch(PATH, {}, '', onDispatch)).rejects.toBeInstanceOf(AccountChangedError)
  expect(getToken).not.toHaveBeenCalled()
  const failure = new AccountChangedError()
  getToken.mockRejectedValueOnce(failure)
  await expect(accountBoundFetch(PATH, {}, 'a', onDispatch)).rejects.toBe(failure)
  expect(fetch).not.toHaveBeenCalled()
  expect(onDispatch).not.toHaveBeenCalled()
})

test('an already aborted request does not begin preflight', async () => {
  const controller = new AbortController()
  controller.abort()
  const onDispatch = jest.fn()
  await expect(accountBoundFetch(PATH, { signal: controller.signal }, 'a', onDispatch))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(getToken).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(onDispatch).not.toHaveBeenCalled()
})

test('cancellation during preflight does not mark or send a request', async () => {
  let release!: (token: string) => void
  getToken.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
  const controller = new AbortController()
  const onDispatch = jest.fn()
  const request = accountBoundFetch(PATH, { signal: controller.signal }, 'a', onDispatch)
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  release('token-for-a')
  await rejected
  expect(fetch).not.toHaveBeenCalled()
  expect(onDispatch).not.toHaveBeenCalled()
})

test.each([409, 400])('only the account-change code reconciles and rejects, without a retry (%s)', async (status) => {
  jest.mocked(fetch).mockResolvedValueOnce(Response.json({ code: ACCOUNT_CHANGED_CODE }, { status }))
  await expect(accountBoundFetch(PATH, {}, 'a')).rejects.toBeInstanceOf(AccountChangedError)
  expect(notifyAccountChanged).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test.each([
  { error: 'Already running' },
  { status: 'error', jobId: 'old-job' },
  { code: 'OTHER_ERROR' },
])('ordinary conflicts retain their body and do not reconcile (%#)', async (body) => {
  const response = Response.json(body, { status: 409 })
  jest.mocked(fetch).mockResolvedValueOnce(response)
  expect(await accountBoundFetch(PATH, {}, 'a')).toBe(response)
  expect(response.bodyUsed).toBe(false)
  expect(await response.json()).toEqual(body)
  expect(notifyAccountChanged).not.toHaveBeenCalled()
})

test('non-JSON errors stay unconsumed for the domain client', async () => {
  const response = new Response('<html>unavailable</html>', { status: 502 })
  jest.mocked(fetch).mockResolvedValueOnce(response)
  expect(await accountBoundFetch(PATH, {}, 'a')).toBe(response)
  expect(await response.text()).toBe('<html>unavailable</html>')
  expect(notifyAccountChanged).not.toHaveBeenCalled()
})

test('network failures propagate after dispatch without retrying', async () => {
  const failure = new TypeError('Connection lost')
  const onDispatch = jest.fn()
  jest.mocked(fetch).mockRejectedValueOnce(failure)
  await expect(accountBoundFetch(PATH, {}, 'a', onDispatch)).rejects.toBe(failure)
  expect(onDispatch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(notifyAccountChanged).not.toHaveBeenCalled()
})
