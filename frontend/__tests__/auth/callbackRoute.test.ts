/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: jest.fn() }))
jest.mock('@/lib/auth/provision-app-user.server', () => ({ provisionAppUser: jest.fn() }))

const mockRecover = jest.fn()
jest.mock('@/lib/auth/sign-in-recovery.server', () => ({
  recoverFromSignInError: (...args: unknown[]) => mockRecover(...args),
}))

type OnError = (params: { error?: unknown; request: NextRequest }) => Response | Promise<Response>
type Options = { onError: OnError }
// What AuthKit's handler does with a request, given the options it was made with.
type AuthKit = (options: Options, request: NextRequest) => Promise<Response>

const succeedTo = (location: string): AuthKit => async () => NextResponse.redirect(location)
const failWith = (error: unknown): AuthKit => async (options, request) => options.onError({ error, request })

// The route reads its redirect URI at load, so each case loads it afresh.
function loadRoute(redirectUri: string | undefined, authkit: AuthKit = failWith(new Error('failed'))) {
  if (redirectUri) process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = redirectUri
  else delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  let route: { GET: (request: NextRequest) => Promise<Response>; onError: OnError } | undefined
  jest.isolateModules(() => {
    const { handleAuth } = require('@workos-inc/authkit-nextjs')
    ;(handleAuth as jest.Mock).mockImplementation(
      (options: Options) => (request: NextRequest) => authkit(options, request)
    )
    const { GET } = require('@/app/auth/callback/route')
    route = { GET, onError: (handleAuth as jest.Mock).mock.calls[0][0].onError }
  })
  return route!
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    mockRecover.mockReset()
    mockRecover.mockResolvedValue({ kind: 'error-page' })
  })

  test('sends a signed-in person on through /auth/finish, to the page they asked for', async () => {
    const { GET } = loadRoute('http://localhost:3000/auth/callback', succeedTo('http://localhost:3000/editor/abc?t=12'))

    const response = await GET(new NextRequest('http://0.0.0.0:3000/auth/callback?code=c&state=s'))

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/finish?to=%2Feditor%2Fabc%3Ft%3D12')
  })

  test('leaves a redirect off-site as it is', async () => {
    const { GET } = loadRoute('http://localhost:3000/auth/callback', succeedTo('https://api.workos.com/authorize?x=1'))

    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?__authkit_start=s'))

    expect(response.headers.get('location')).toBe('https://api.workos.com/authorize?x=1')
  })

  test('sends a failed sign-in to the error page on the browser-facing origin', async () => {
    const { GET } = loadRoute('http://localhost:3000/auth/callback')

    const response = await GET(new NextRequest('http://0.0.0.0:3000/auth/callback?error=access_denied'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error')
  })

  test('falls back to the request origin without a configured redirect URI', async () => {
    const { onError } = loadRoute(undefined)

    const response = await onError({
      request: new NextRequest('http://localhost:3000/auth/callback?code=stale&state=s'),
    })

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error')
  })

  test('restarts sign-in where recovery says to', async () => {
    mockRecover.mockResolvedValue({ kind: 'restart', url: 'https://auth.test/sign-in?state=fresh' })
    const { GET } = loadRoute('http://localhost:3000/auth/callback')

    const response = await GET(new NextRequest('http://0.0.0.0:3000/auth/callback?code=c&state=s'))

    expect(response.headers.get('location')).toBe('https://auth.test/sign-in?state=fresh')
  })

  test('sends a person still signed in to the Library, not through /auth/finish', async () => {
    mockRecover.mockResolvedValue({ kind: 'home' })
    const { GET } = loadRoute('http://localhost:3000/auth/callback')

    const response = await GET(new NextRequest('http://0.0.0.0:3000/auth/callback?code=c&state=s'))

    expect(response.headers.get('location')).toBe('http://localhost:3000/')
  })

  test('falls back to the error page when recovery itself fails', async () => {
    mockRecover.mockRejectedValue(new Error('WorkOS unavailable'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = loadRoute('http://localhost:3000/auth/callback')

    const response = await GET(new NextRequest('http://0.0.0.0:3000/auth/callback?code=c&state=s'))

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error')
  })
})
