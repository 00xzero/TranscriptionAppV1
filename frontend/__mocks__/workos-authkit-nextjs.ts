/**
 * Test double for `@workos-inc/authkit-nextjs` (ESM-only, which Jest's
 * CommonJS resolver cannot load). Mapped in jest.config.js. Signed out by
 * default; suites set `withAuth` / `authkit` results per test.
 */
import { NextResponse, type NextRequest } from 'next/server'

export const withAuth = jest.fn(async () => ({ user: null }))

export const refreshSession = jest.fn(async () => ({ user: null }))

export const authkit = jest.fn(async () => ({
  session: { user: null },
  headers: new Headers(),
}))

export const handleAuthkitHeaders = jest.fn(
  (request: NextRequest, _headers: Headers, options?: { redirect?: string | URL }) =>
    options?.redirect
      ? NextResponse.redirect(new URL(options.redirect, request.url))
      : NextResponse.next({ request })
)

/** As AuthKit does: only browser-safe headers (cookies, cache control) reach the response. */
export const partitionAuthkitHeaders = jest.fn((request: NextRequest, authkitHeaders: Headers) => {
  const responseHeaders = new Headers()
  for (const [name, value] of authkitHeaders) {
    if (['set-cookie', 'cache-control', 'vary'].includes(name.toLowerCase())) responseHeaders.append(name, value)
  }
  return { requestHeaders: new Headers(request.headers), responseHeaders }
})

export const applyResponseHeaders = jest.fn((response: Response, responseHeaders: Headers) => {
  for (const [name, value] of responseHeaders) response.headers.append(name, value)
  return response
})

export const signOut = jest.fn(async (_options?: { returnTo?: string }) => undefined)

export const saveSession = jest.fn(async (_session: unknown, _url: string) => undefined)

/** The WorkOS client; suites stub the calls they need on `userManagement` and `pkce`. */
export const mockWorkOS = {
  userManagement: {
    authenticateWithPassword: jest.fn(),
    authenticateWithEmailVerification: jest.fn(),
    authenticateWithRadarEmailChallenge: jest.fn(),
    authenticateWithCode: jest.fn(),
    createUser: jest.fn(),
    getEmailVerification: jest.fn(),
    sendVerificationEmail: jest.fn(),
    createPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
    getAuthorizationUrl: jest.fn(
      (options: { provider: string; state: string; codeChallenge: string }) =>
        `https://api.workos.test/authorize?provider=${options.provider}&state=${options.state}&code_challenge=${options.codeChallenge}`
    ),
  },
  pkce: {
    generate: jest.fn(async () => ({
      codeVerifier: 'v'.repeat(43),
      codeChallenge: 'challenge-123',
      codeChallengeMethod: 'S256',
    })),
  },
}

export const getWorkOS = jest.fn(() => mockWorkOS)
