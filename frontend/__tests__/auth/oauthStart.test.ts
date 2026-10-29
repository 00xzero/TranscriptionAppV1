/** @jest-environment node */

import '../helpers/authEnv'
import { NextRequest } from 'next/server'
import { mockWorkOS } from '@/__mocks__/workos-authkit-nextjs'
import { createCookieJar } from '../helpers/cookieJar'
import { GET, POST } from '@/app/auth/oauth/[provider]/route'
import { oauthAttempts } from '@/lib/auth/attempt-cookies.server'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar }))

function start(provider: string, fields: Record<string, string> = {}, origin = 'http://localhost:3000') {
  const body = new URLSearchParams({ next: '/editor/abc', ...fields })
  const request = new NextRequest(`http://localhost:3000/auth/oauth/${provider}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  return POST(request, { params: Promise.resolve({ provider }) })
}

describe('POST /auth/oauth/[provider]', () => {
  beforeEach(() => {
    mockJar.clear()
    jest.clearAllMocks()
  })

  test('seals a new attempt into its own cookie and sends the browser to that provider, uncached', async () => {
    const response = await start('google', { signalsId: 'radar-token' })

    expect(response.status).toBe(303)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('provider')).toBe('GoogleOAuth')
    expect(location.searchParams.get('code_challenge')).toBe('challenge-123')
    const state = location.searchParams.get('state')!

    const stored = mockJar.store.get(`olivetti-oauth-${state}`)!
    expect(stored.options).toEqual({ httpOnly: true, sameSite: 'lax', secure: false, path: '/auth', maxAge: 600 })
    await expect(oauthAttempts.read(state)).resolves.toEqual({
      state,
      provider: 'google',
      codeVerifier: 'v'.repeat(43),
      next: '/editor/abc',
      signalsId: 'radar-token',
    })
    expect(mockWorkOS.userManagement.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client_test', redirectUri: 'http://localhost:3000/auth/callback' })
    )
  })

  test('Microsoft goes to Microsoft, and an off-site destination becomes the Library', async () => {
    const response = await start('microsoft', { next: 'https://evil.test' })
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!

    expect(new URL(response.headers.get('location')!).searchParams.get('provider')).toBe('MicrosoftOAuth')
    const stored = await oauthAttempts.read(state)
    expect(stored).toMatchObject({ next: '/' })
    expect(stored).not.toHaveProperty('signalsId')
  })

  test('refuses an unknown provider and a post from another site', async () => {
    expect((await start('github')).status).toBe(404)
    expect((await start('google', {}, 'https://evil.test')).status).toBe(403)
    expect(mockJar.names()).toEqual([])
  })

  test('keeps at most five attempts: a sixth replaces the oldest', async () => {
    const spy = jest.spyOn(Date, 'now')
    let now = Date.UTC(2026, 9, 28, 12)
    spy.mockImplementation(() => (now += 1000))
    const states: string[] = []
    for (let i = 0; i < 6; i++) {
      const response = await start('google')
      states.push(new URL(response.headers.get('location')!).searchParams.get('state')!)
    }
    spy.mockRestore()

    expect(mockJar.names()).toHaveLength(5)
    expect(mockJar.names()).not.toContain(`olivetti-oauth-${states[0]}`)
    expect(mockJar.names()).toContain(`olivetti-oauth-${states[5]}`)
  })
})

describe('GET /auth/oauth/[provider]', () => {
  test('an old link goes back to the sign-in page', () => {
    expect(GET(new NextRequest('http://localhost:3000/auth/oauth/google')).headers.get('location')).toBe(
      'http://localhost:3000/auth'
    )
  })
})
