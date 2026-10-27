import 'server-only'

import { CallbackError, getSignInUrl, withAuth } from '@workos-inc/authkit-nextjs'
import { unsealData } from 'iron-session'
import { z } from 'zod'

/**
 * Where a failed sign-in callback goes next.
 *
 * A sign-in that failed only because its attempt went stale (its 10-minute
 * PKCE cookie lapsed, it was finished in another browser, or its code was
 * already used) is quietly started again: WorkOS usually still knows the
 * person, so the restart often finishes without them seeing anything. Every
 * other failure, and a quick failure of a restart, ends on /auth/error.
 *
 * A restart is marked in AuthKit's sealed state, which comes back in the
 * callback URL, so the guard holds even when the browser keeps no cookies.
 * Reading that state relies on AuthKit's internal format (4.5.0: iron-session
 * sealed with WORKOS_COOKIE_PASSWORD); if it changes, nothing can be read and
 * every failure shows the error page, never a loop.
 */

export type SignInRecovery =
  | { kind: 'home' }
  | { kind: 'restart'; url: string }
  | { kind: 'error-page' }

export const RETRY_STATE = 'sign-in-retry'

// AuthKit's own state (get-authorization-url.js). The nonce and verifier
// prove it is one; an unreadable seal unseals to {} and fails this.
const SealedStateSchema = z.object({
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
  customState: z.string().optional(),
  returnPathname: z.string().optional(),
})

type StateReading =
  | { kind: 'readable'; customState?: string; returnPathname?: string }
  // Unreadable, but its own (unauthenticated) expiry has passed: a sign-in
  // that sat too long. Restarting cannot loop quickly, since a restart's
  // state is fresh and readable until it too has sat for 10 minutes.
  | { kind: 'expired' }
  | { kind: 'unreadable' }

export async function recoverFromSignInError(error: unknown, request: Request): Promise<SignInRecovery> {
  const params = new URL(request.url).searchParams
  if (!isStaleAttempt(error, params)) return { kind: 'error-page' }

  // Still signed in (an old callback link): nothing to sign in to.
  if ((await withAuth()).user) return { kind: 'home' }

  const state = params.get('state')
  if (!state) return { kind: 'error-page' }
  const reading = await readSealedState(state)
  if (reading.kind === 'unreadable') return { kind: 'error-page' }
  if (reading.kind === 'readable' && reading.customState === RETRY_STATE) return { kind: 'error-page' }

  const returnTo = reading.kind === 'readable' ? safeReturnPath(reading.returnPathname) : '/'
  return { kind: 'restart', url: await getSignInUrl({ returnTo, state: RETRY_STATE }) }
}

function isStaleAttempt(error: unknown, params: URLSearchParams): boolean {
  if (error instanceof CallbackError) {
    if (error.code === 'missing_pkce_cookie' || error.code === 'oauth_state_mismatch') return true
    // WorkOS sends ?error= when it refused the sign-in: that is an answer.
    return error.code === 'missing_auth_params' && !params.has('error')
  }
  // A used or expired code, from the WorkOS SDK's OauthException.
  return (
    error instanceof Error &&
    error.name === 'OauthException' &&
    (error as Error & { error?: unknown }).error === 'invalid_grant'
  )
}

async function readSealedState(state: string): Promise<StateReading> {
  const password = process.env.WORKOS_COOKIE_PASSWORD
  if (!password) return { kind: 'unreadable' }
  let unsealed: unknown
  try {
    unsealed = await unsealData(state, { password })
  } catch {
    return { kind: 'unreadable' }
  }
  const parsed = SealedStateSchema.safeParse(unsealed)
  if (parsed.success) {
    return { kind: 'readable', customState: parsed.data.customState, returnPathname: parsed.data.returnPathname }
  }
  return sealExpired(state) ? { kind: 'expired' } : { kind: 'unreadable' }
}

// An iron seal is eight '*'-separated parts; the sixth is its expiry in ms.
function sealExpired(state: string): boolean {
  const parts = state.split('*')
  if (parts.length !== 8 || parts[0] !== 'Fe26.2' || !/^\d+$/.test(parts[5])) return false
  return Number(parts[5]) < Date.now()
}

// The path AuthKit sealed for this sign-in, kept to this app and never an
// auth route.
function safeReturnPath(path: string | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  const base = 'https://app.invalid'
  const url = new URL(path, base)
  if (url.origin !== base) return '/'
  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return '/'
  return `${url.pathname}${url.search}`
}
