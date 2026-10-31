/** @jest-environment node */

import { createCookieJar } from '../helpers/cookieJar'

const mockJar = createCookieJar()
jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar }))

const LOGOUT_URL =
  'https://api.workos.com/user_management/sessions/logout?session_id=session_01&return_to=http%3A%2F%2Flocalhost%3A3000%2Fauth'

/** Both the route and origin helper read the environment when they load. */
async function loadRoute() {
  let route!: typeof import('@/app/auth/sign-out/route')
  let workos!: typeof import('@workos-inc/authkit-nextjs')
  let navigation!: typeof import('next/navigation')
  await jest.isolateModulesAsync(async () => {
    route = await import('@/app/auth/sign-out/route')
    workos = await import('@workos-inc/authkit-nextjs')
    navigation = await import('next/navigation')
  })
  return { POST: route.POST, signOutMock: workos.signOut as unknown as jest.Mock, redirect: navigation.redirect }
}

/** A sign-out post, from this origin (or none). */
function post(origin: string | null) {
  const headers = origin ? { origin } : undefined
  return new Request('http://localhost:3000/auth/sign-out', { method: 'POST', headers })
}

describe('POST /auth/sign-out', () => {
  beforeEach(() => {
    mockJar.clear()
    jest.replaceProperty(process, 'env', { ...process.env })
    delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
    delete process.env.WORKOS_REDIRECT_URI
  })
  afterEach(() => jest.restoreAllMocks())

  describe.each([
    {
      name: 'public redirect URI takes precedence over the server-only URI',
      publicUri: 'https://public.example.com/auth/callback',
      serverUri: 'https://server.example.com/auth/callback',
      origin: 'https://public.example.com',
    },
    {
      name: 'server-only redirect URI is the fallback',
      publicUri: undefined,
      serverUri: 'https://server.example.com/auth/callback',
      origin: 'https://server.example.com',
    },
    {
      name: 'request origin is used without a configured URI',
      publicUri: undefined,
      serverUri: undefined,
      origin: 'http://localhost:3000',
    },
  ])('$name', ({ publicUri, serverUri, origin }) => {
    beforeEach(() => {
      if (publicUri) process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = publicUri
      if (serverUri) process.env.WORKOS_REDIRECT_URI = serverUri
    })

    test('answers AuthKit’s redirect with a 303, so the browser follows it with a GET', async () => {
      const { POST, signOutMock, redirect } = await loadRoute()
      // A Route Handler's default 307 would POST to WorkOS again.
      signOutMock.mockImplementation(async () => redirect(LOGOUT_URL))

      const response = await POST(post(origin))

      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(LOGOUT_URL)
      expect(signOutMock).toHaveBeenCalledWith({ returnTo: `${origin}/auth` })
      // The app's other open tabs learn the session ended.
      expect(mockJar.store.get('olivetti-account')?.value).toBe('none')
    })

    test('falls back to the app’s sign-in page with a 303 if AuthKit returns', async () => {
      const { POST, signOutMock } = await loadRoute()
      signOutMock.mockResolvedValue(undefined)

      const response = await POST(post(origin))

      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(`${origin}/auth`)
      expect(signOutMock).toHaveBeenCalledWith({ returnTo: `${origin}/auth` })
    })
  })

  test('passes on any failure that is not a redirect', async () => {
    const { POST, signOutMock } = await loadRoute()
    const error = new Error('WorkOS unavailable')
    signOutMock.mockRejectedValue(error)

    await expect(
      POST(post('http://localhost:3000'))
    ).rejects.toBe(error)
  })

  test.each([
    ['another site', 'https://evil.example'],
    ['no origin at all', null],
  ])('refuses a post from %s, leaving the session alone', async (_name, origin) => {
    const { POST, signOutMock } = await loadRoute()

    const response = await POST(post(origin))

    expect(response.status).toBe(403)
    expect(signOutMock).not.toHaveBeenCalled()
    expect(mockJar.names()).toEqual([])
  })
})
