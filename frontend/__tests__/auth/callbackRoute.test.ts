/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/infra/supabase/admin', () => ({ createAdminClient: jest.fn() }))
jest.mock('@/lib/auth/provision-app-user.server', () => ({ provisionAppUser: jest.fn() }))

type OnError = (params: { error?: unknown; request: NextRequest }) => Response | Promise<Response>

// The route reads its redirect URI at load, so each case loads it afresh.
function loadOnError(redirectUri: string | undefined): OnError {
  if (redirectUri) process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = redirectUri
  else delete process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  let onError: OnError | undefined
  jest.isolateModules(() => {
    require('@/app/auth/callback/route')
    const { handleAuth } = require('@workos-inc/authkit-nextjs')
    onError = (handleAuth as jest.Mock).mock.calls[0][0].onError
  })
  return onError!
}

describe('GET /auth/callback errors', () => {
  test('sends a failed sign-in to the error page on the browser-facing origin', async () => {
    const onError = loadOnError('http://localhost:3000/auth/callback')

    const response = await onError({
      error: new Error('Missing required auth parameter'),
      request: new NextRequest('http://0.0.0.0:3000/auth/callback?error=access_denied'),
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error')
  })

  test('falls back to the request origin without a configured redirect URI', async () => {
    const onError = loadOnError(undefined)

    const response = await onError({
      request: new NextRequest('http://localhost:3000/auth/callback?code=stale&state=s'),
    })

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/error')
  })
})
