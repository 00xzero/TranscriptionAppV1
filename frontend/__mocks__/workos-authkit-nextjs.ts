/**
 * Test double for `@workos-inc/authkit-nextjs` (ESM-only, which Jest's
 * CommonJS resolver cannot load). Mapped in jest.config.js. Signed out by
 * default; suites set `withAuth` / `authkit` results per test.
 */
import { NextResponse, type NextRequest } from 'next/server'

export const withAuth = jest.fn(async () => ({ user: null }))

export const authkit = jest.fn(async () => ({
  session: { user: null },
  headers: new Headers(),
  authorizationUrl: 'https://auth.test/authorize',
}))

export const handleAuthkitHeaders = jest.fn(
  (request: NextRequest, _headers: Headers, options?: { redirect?: string | URL }) =>
    options?.redirect
      ? NextResponse.redirect(new URL(options.redirect, request.url))
      : NextResponse.next({ request })
)

export const getSignInUrl = jest.fn(async () => 'https://auth.test/sign-in')

export const signOut = jest.fn(async (_options?: { returnTo?: string }) => undefined)

export const handleAuth = jest.fn(() => async () => new Response(null, { status: 302 }))

export class CallbackError extends Error {
  constructor(
    message: string,
    readonly code: 'missing_auth_params' | 'missing_pkce_cookie' | 'oauth_state_mismatch' | 'missing_tokens'
  ) {
    super(message)
    this.name = 'CallbackError'
  }
}
