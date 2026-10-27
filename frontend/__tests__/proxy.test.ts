/** @jest-environment node */

import { NextRequest } from 'next/server'
import { authkit } from '@workos-inc/authkit-nextjs'
import { proxy } from '../proxy'

const authkitMock = authkit as unknown as jest.Mock

const AUTHORIZATION_URL = 'https://auth.test/authorize?return=%2Feditor%2Fabc'

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`)
}

function sessionFor(user: { id: string } | null) {
  authkitMock.mockResolvedValue({
    session: { user },
    headers: new Headers(),
    authorizationUrl: user ? undefined : AUTHORIZATION_URL,
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

  test('sends signed-out visitors on protected routes to WorkOS sign-in', async () => {
    for (const path of ['/', '/transcripts', '/editor/abc', '/recording/new', '/projects/p1', '/people']) {
      const response = await proxy(request(path))
      expect(response.headers.get('location')).toBe(AUTHORIZATION_URL)
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

  test('shows the sign-in error page only to signed-out visitors', async () => {
    expect((await proxy(request('/auth/error'))).headers.get('location')).toBeNull()

    // Still signed in (a stale callback link): nothing to try again.
    sessionFor({ id: 'user_01' })
    expect((await proxy(request('/auth/error'))).headers.get('location')).toBe('http://localhost:3000/')
  })

  test('leaves public routes and API routes to answer for themselves', async () => {
    const page = await proxy(request('/auth'))
    const api = await proxy(request('/api/transcripts'))

    expect(page.headers.get('location')).toBeNull()
    expect(api.headers.get('location')).toBeNull()
  })
})
