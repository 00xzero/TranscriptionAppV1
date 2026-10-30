/** @jest-environment node */

import { NextRequest } from 'next/server'
import { authkit } from '@workos-inc/authkit-nextjs'
import { proxy } from '../proxy'

const authkitMock = authkit as unknown as jest.Mock

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`)
}

function sessionFor(user: { id: string } | null) {
  authkitMock.mockResolvedValue({
    session: { user },
    headers: new Headers(),
  })
}

describe('proxy', () => {
  beforeEach(() => {
    authkitMock.mockReset()
    sessionFor(null)
  })

  test('leaves the Inngest endpoint alone', async () => {
    const response = await proxy(request('/api/inngest'))

    expect(authkitMock).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBeNull()
  })

  describe.each([null, 'wos-session=arbitrary'])('webhook bypass with cookie %s', (cookie) => {
    test.each([
      ['POST', '/api/webhooks/deepgram?delivery=1'],
      ['POST', '/api/webhooks/soniox?delivery=1'],
      ['POST', '/api/webhooks/assemblyai?delivery=1'],
      ['GET', '/api/webhooks/deepgram/health?token=health-test'],
      ['POST', '/api/webhooks/future/provider?delivery=1'],
    ])('forwards %s %s without AuthKit', async (method, path) => {
      authkitMock.mockImplementation(() => {
        throw new Error('Webhook requests must not call AuthKit')
      })
      const headers = new Headers()
      if (cookie) headers.set('cookie', cookie)
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`, { method, headers }))

      expect(authkitMock).not.toHaveBeenCalled()
      expect(response.status).toBe(200)
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('x-action-redirect')).toBeNull()
      expect(response.headers.get('x-workos-middleware')).toBeNull()
    })
  })

  test('forwards webhook authorization upstream and leaves the request body unread', async () => {
    authkitMock.mockImplementation(() => {
      throw new Error('Webhook requests must not call AuthKit')
    })
    const authorization = `Basic ${Buffer.from('deepgram:test-secret').toString('base64')}`
    const body = '{\n  "request_id": "request-1"\n}\n'
    const callback = new NextRequest('http://localhost:3000/api/webhooks/deepgram?delivery=1', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body,
    })

    const response = await proxy(callback)

    expect(authkitMock).not.toHaveBeenCalled()
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-middleware-request-authorization')).toBe(authorization)
    expect(response.headers.get('x-middleware-request-content-type')).toBe('application/json')
    expect(response.headers.get('authorization')).toBeNull()
    expect(callback.headers.get('authorization')).toBe(authorization)
    expect(callback.method).toBe('POST')
    expect(callback.nextUrl.search).toBe('?delivery=1')
    expect(callback.bodyUsed).toBe(false)
    await expect(callback.text()).resolves.toBe(body)
  })

  test.each(['/api/webhooks', '/api/webhooks-other/deepgram', '/api/transcripts'])(
    'keeps AuthKit processing for %s',
    async (path) => {
      const incoming = request(path)

      await proxy(incoming)

      expect(authkitMock).toHaveBeenCalledTimes(1)
      expect(authkitMock).toHaveBeenCalledWith(incoming)
    }
  )

  test('sends signed-out visitors on protected routes to our sign-in page, with where they were going', async () => {
    expect((await proxy(request('/'))).headers.get('location')).toBe('http://localhost:3000/auth')
    for (const path of ['/transcripts', '/editor/abc?t=12', '/recording/new', '/projects/p1', '/people']) {
      const response = await proxy(request(path))
      expect(response.headers.get('location')).toBe(
        `http://localhost:3000/auth?${new URLSearchParams({ next: path })}`
      )
    }
  })

  // An eager token is read before AuthKit knows the user, so an account switch
  // in another tab at that moment leaves this tab with the old account's token.
  test('does not hand pages an eager access token', async () => {
    sessionFor({ id: 'user_01' })

    await proxy(request('/'))

    expect(authkitMock).toHaveBeenCalledTimes(1)
    expect(authkitMock.mock.calls[0][1]?.eagerAuth).toBeFalsy()
  })

  test('lets signed-in visitors through protected routes', async () => {
    sessionFor({ id: 'user_01' })

    const response = await proxy(request('/editor/abc'))

    expect(response.headers.get('location')).toBeNull()
  })

  test('sends signed-in visitors away from the sign-in entry point', async () => {
    sessionFor({ id: 'user_01' })

    const response = await proxy(request('/auth'))

    expect(response.headers.get('location')).toBe('http://localhost:3000/')
  })

  test('lets signed-in visitors post to sign-out instead of bouncing them to /', async () => {
    sessionFor({ id: 'user_01' })

    const response = await proxy(
      new NextRequest('http://localhost:3000/auth/sign-out', { method: 'POST' })
    )

    expect(response.headers.get('location')).toBeNull()
  })

  test('never redirects the sign-in callback', async () => {
    sessionFor({ id: 'user_01' })
    expect((await proxy(request('/auth/callback?code=c'))).headers.get('location')).toBeNull()

    sessionFor(null)
    expect((await proxy(request('/auth/callback?code=c'))).headers.get('location')).toBeNull()
  })

  test('lets the finish step check the session itself, signed in or not', async () => {
    expect((await proxy(request('/auth/finish?to=%2F'))).headers.get('location')).toBeNull()

    sessionFor({ id: 'user_01' })
    expect((await proxy(request('/auth/finish?to=%2F'))).headers.get('location')).toBeNull()
  })

  test('leaves the Google/Microsoft start and the reset link alone, signed in or not', async () => {
    for (const user of [null, { id: 'user_01' }]) {
      sessionFor(user)
      const start = await proxy(new NextRequest('http://localhost:3000/auth/oauth/google', { method: 'POST' }))
      const reset = await proxy(request('/auth/reset-password?token=t'))
      expect(start.headers.get('location')).toBeNull()
      expect(reset.headers.get('location')).toBeNull()
    }
  })

  // Signed out in another tab: this tab's next Server Action (AuthKit's focus
  // check, a refresh) must leave the page, not follow a redirect it ignores.
  test('answers a signed-out Server Action with Next’s action redirect, so the page reloads on sign-in', async () => {
    authkitMock.mockResolvedValue({
      session: { user: null },
      headers: new Headers({ 'set-cookie': 'wos-session=; Max-Age=0; Path=/', 'x-workos-middleware': 'true' }),
    })

    const response = await proxy(
      new NextRequest('http://localhost:3000/projects?view=grid', { method: 'POST', headers: { 'next-action': 'abc123' } })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-action-redirect')).toBe('/auth?next=%2Fprojects%3Fview%3Dgrid;replace')
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(response.headers.get('cache-control')).toBe('no-store')
    // AuthKit's own session headers still reach the browser; its internal ones don't.
    expect(response.headers.get('set-cookie')).toContain('wos-session=;')
    expect(response.headers.get('x-workos-middleware')).toBeNull()
  })

  test('lets a signed-in Server Action through, and the Library’s action keeps a plain sign-in target', async () => {
    sessionFor({ id: 'user_01' })
    const signedIn = await proxy(
      new NextRequest('http://localhost:3000/projects', { method: 'POST', headers: { 'next-action': 'abc123' } })
    )
    expect(signedIn.headers.get('x-action-redirect')).toBeNull()
    expect(signedIn.headers.get('location')).toBeNull()

    sessionFor(null)
    const library = await proxy(new NextRequest('http://localhost:3000/', { method: 'POST', headers: { 'next-action': 'abc123' } }))
    expect(library.headers.get('x-action-redirect')).toBe('/auth;replace')
  })

  test('a signed-out Server Action on the sign-in page itself is left alone', async () => {
    const response = await proxy(new NextRequest('http://localhost:3000/auth', { method: 'POST', headers: { 'next-action': 'abc123' } }))

    expect(response.headers.get('x-action-redirect')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
  })

  test('leaves public routes and API routes to answer for themselves', async () => {
    const page = await proxy(request('/auth'))
    const api = await proxy(request('/api/transcripts'))

    expect(page.headers.get('location')).toBeNull()
    expect(api.headers.get('location')).toBeNull()
  })
})
