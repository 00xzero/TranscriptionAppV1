/** @jest-environment node */

import { sealData } from 'iron-session'
import { CallbackError, getSignInUrl, withAuth } from '@workos-inc/authkit-nextjs'
import { RETRY_STATE, recoverFromSignInError } from '@/lib/auth/sign-in-recovery.server'

const withAuthMock = withAuth as unknown as jest.Mock
const getSignInUrlMock = getSignInUrl as unknown as jest.Mock

const PASSWORD = 'test-cookie-password-at-least-32-characters-long'
const SIGN_IN_URL = 'https://auth.test/sign-in?state=fresh'

// AuthKit's own state, sealed as get-authorization-url.js seals it.
function authkitState(fields: { customState?: string; returnPathname?: string } = {}, ttl = 600) {
  return sealData({ nonce: 'nonce-1', codeVerifier: 'verifier-1', ...fields }, { password: PASSWORD, ttl })
}

function callback(query: Record<string, string>) {
  return new Request(`http://localhost:3000/auth/callback?${new URLSearchParams(query)}`)
}

function oauthException(error: string) {
  return Object.assign(new Error('OAuth error'), { name: 'OauthException', error })
}

const missingCookie = new CallbackError('Sign-in session could not be verified.', 'missing_pkce_cookie')

describe('recoverFromSignInError', () => {
  beforeEach(() => {
    jest.useRealTimers()
    process.env.WORKOS_COOKIE_PASSWORD = PASSWORD
    withAuthMock.mockReset()
    withAuthMock.mockResolvedValue({ user: null })
    getSignInUrlMock.mockReset()
    getSignInUrlMock.mockResolvedValue(SIGN_IN_URL)
  })

  test('restarts a stale attempt once, back to the page it was going to', async () => {
    const state = await authkitState({ returnPathname: '/editor/abc?t=12' })

    for (const error of [
      missingCookie,
      new CallbackError('OAuth state mismatch', 'oauth_state_mismatch'),
      oauthException('invalid_grant'),
    ]) {
      await expect(recoverFromSignInError(error, callback({ code: 'c', state }))).resolves.toEqual({
        kind: 'restart',
        url: SIGN_IN_URL,
      })
    }
    expect(getSignInUrlMock).toHaveBeenLastCalledWith({ returnTo: '/editor/abc?t=12', state: RETRY_STATE })
  })

  test('shows the error page when the restart fails too', async () => {
    const state = await authkitState({ customState: RETRY_STATE, returnPathname: '/projects' })

    await expect(recoverFromSignInError(missingCookie, callback({ code: 'c', state }))).resolves.toEqual({
      kind: 'error-page',
    })
    expect(getSignInUrlMock).not.toHaveBeenCalled()
  })

  test('restarts a sign-in that sat too long, to the Library, even when it was a restart', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z') })
    const state = await authkitState({ customState: RETRY_STATE, returnPathname: '/projects' })
    // Past the seal's ten minutes and iron's one minute of clock skew.
    jest.setSystemTime(new Date('2026-10-27T10:11:01Z'))

    await expect(recoverFromSignInError(missingCookie, callback({ code: 'c', state }))).resolves.toEqual({
      kind: 'restart',
      url: SIGN_IN_URL,
    })
    expect(getSignInUrlMock).toHaveBeenCalledWith({ returnTo: '/', state: RETRY_STATE })
  })

  test('shows the error page for a state it cannot read', async () => {
    const forged = 'Fe26.2*1*salt*iv*data*9999999999999*hsalt*hmac'
    const otherPassword = await sealData(
      { nonce: 'n', codeVerifier: 'v' },
      { password: 'another-cookie-password-at-least-32-chars', ttl: 600 }
    )
    const notAuthkit = await sealData({ hello: 'world' }, { password: PASSWORD, ttl: 600 })

    for (const state of ['garbage', forged, otherPassword, notAuthkit]) {
      await expect(recoverFromSignInError(missingCookie, callback({ code: 'c', state }))).resolves.toEqual({
        kind: 'error-page',
      })
    }
    await expect(recoverFromSignInError(missingCookie, callback({ code: 'c' }))).resolves.toEqual({
      kind: 'error-page',
    })
    expect(getSignInUrlMock).not.toHaveBeenCalled()
  })

  test('sends a person who is still signed in to the Library', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01' } })
    const state = await authkitState()

    await expect(
      recoverFromSignInError(oauthException('invalid_grant'), callback({ code: 'used', state }))
    ).resolves.toEqual({ kind: 'home' })
    expect(getSignInUrlMock).not.toHaveBeenCalled()
  })

  test('shows the error page for failures a restart would not fix', async () => {
    const state = await authkitState()
    const cases: [unknown, Record<string, string>][] = [
      // WorkOS refused the sign-in.
      [new CallbackError('Missing required auth parameter', 'missing_auth_params'), { error: 'access_denied', state }],
      [new CallbackError('response is missing tokens', 'missing_tokens'), { code: 'c', state }],
      [oauthException('invalid_client'), { code: 'c', state }],
      // Provisioning, WorkOS unreachable, anything unknown.
      [new Error('insert failed'), { code: 'c', state }],
      [new TypeError('fetch failed'), { code: 'c', state }],
    ]

    for (const [error, query] of cases) {
      await expect(recoverFromSignInError(error, callback(query))).resolves.toEqual({ kind: 'error-page' })
    }
    expect(withAuthMock).not.toHaveBeenCalled()
  })

  test('never returns to an auth route or another site', async () => {
    for (const returnPathname of ['/auth/callback?code=x', '/auth', '//evil.test/x', '/\\evil.test', 'https://evil.test']) {
      getSignInUrlMock.mockClear()
      const state = await authkitState({ returnPathname })

      await recoverFromSignInError(missingCookie, callback({ code: 'c', state }))

      expect(getSignInUrlMock).toHaveBeenCalledWith({ returnTo: '/', state: RETRY_STATE })
    }
  })
})
