/** @jest-environment node */

import { redirect } from 'next/navigation'
import { signOut } from '@workos-inc/authkit-nextjs'
import { POST } from '@/app/auth/sign-out/route'

const signOutMock = signOut as unknown as jest.Mock

const LOGOUT_URL =
  'https://api.workos.com/user_management/sessions/logout?session_id=session_01&return_to=http%3A%2F%2Flocalhost%3A3000%2Fauth'

describe('POST /auth/sign-out', () => {
  beforeEach(() => {
    signOutMock.mockReset()
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = 'http://localhost:3000/auth/callback'
  })

  test('answers AuthKit’s redirect with a 303, so the browser follows it with a GET', async () => {
    // AuthKit clears the cookie and ends with redirect(), which a Route
    // Handler would answer with 307: a second POST, to WorkOS.
    signOutMock.mockImplementation(async () => redirect(LOGOUT_URL))

    const response = await POST(new Request('http://localhost:3000/auth/sign-out', { method: 'POST' }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(LOGOUT_URL)
    expect(signOutMock).toHaveBeenCalledWith({ returnTo: 'http://localhost:3000/auth' })
  })

  test('passes on any failure that is not a redirect', async () => {
    signOutMock.mockRejectedValue(new Error('WorkOS unavailable'))

    await expect(
      POST(new Request('http://localhost:3000/auth/sign-out', { method: 'POST' }))
    ).rejects.toThrow('WorkOS unavailable')
  })
})
