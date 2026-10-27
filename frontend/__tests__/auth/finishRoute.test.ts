/** @jest-environment node */

import { NextRequest } from 'next/server'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { GET } from '@/app/auth/finish/route'

const withAuthMock = withAuth as unknown as jest.Mock

function finish(to: string) {
  return GET(new NextRequest(`http://localhost:3000/auth/finish?to=${encodeURIComponent(to)}`))
}

describe('GET /auth/finish', () => {
  beforeEach(() => {
    withAuthMock.mockReset()
  })

  test('sends a person whose session stuck on to the page they asked for', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01' } })

    const response = await finish('/editor/abc?t=12')

    expect(response.headers.get('location')).toBe('http://localhost:3000/editor/abc?t=12')
  })

  test('stops on the error page when the browser did not keep the session', async () => {
    withAuthMock.mockResolvedValue({ user: null })

    const response = await finish('/editor/abc')

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error?reason=session')
  })

  test('never sends anyone off-site or back into sign-in', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01' } })

    for (const to of ['//evil.test/x', 'https://evil.test', '/auth/callback?code=x', '/auth/finish?to=/']) {
      expect((await finish(to)).headers.get('location')).toBe('http://localhost:3000/')
    }
  })
})
