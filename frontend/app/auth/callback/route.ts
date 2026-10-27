/**
 * Auth callback route for WorkOS AuthKit.
 *
 * WorkOS redirects here after sign-in; AuthKit exchanges the code for a
 * session and returns the person to the page they asked for, by way of
 * /auth/finish, which checks the browser kept the session cookie (a dropped
 * cookie would otherwise loop through WorkOS, every callback succeeding). The
 * first sign-in of a WorkOS user creates its app_users row. If that fails,
 * AuthKit clears the new session, so nobody is left signed in without an
 * account.
 *
 * A failed callback goes where lib/auth/sign-in-recovery.server.ts says: a
 * stale attempt is started again once, a person still signed in goes to the
 * Library, and anything else ends on /auth/error, which offers to try again.
 */
import { handleAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/infra/supabase/admin'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'
import { recoverFromSignInError, type SignInRecovery } from '@/lib/auth/sign-in-recovery.server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined

// Responses made by onError, so GET leaves them alone. AuthKit returns the
// very object onError made.
const failures = new WeakSet<Response>()

const authkitCallback = handleAuth({
  baseURL,
  onSuccess: async ({ user }) => {
    await provisionAppUser(createAdminClient(), { id: user.id, email: user.email })
  },
  // AuthKit has already logged the error. A throw here would escape AuthKit's
  // handler, so a failed recovery falls back to the error page.
  onError: async ({ error, request }) => {
    let recovery: SignInRecovery
    try {
      recovery = await recoverFromSignInError(error, request)
    } catch (recoveryError) {
      console.error('[sign-in recovery failed]', recoveryError)
      recovery = { kind: 'error-page' }
    }
    const path = recovery.kind === 'home' ? '/' : '/auth/error'
    const response = recovery.kind === 'restart'
      ? NextResponse.redirect(recovery.url)
      : NextResponse.redirect(new URL(path, baseURL ?? request.url))
    failures.add(response)
    return response
  },
})

export async function GET(request: NextRequest) {
  const response = await authkitCallback(request)
  const location = response.headers.get('location')
  if (failures.has(response) || !location) return response

  // A signed-in callback redirects within the app; anything else (AuthKit
  // sending a sign-in start on to WorkOS) passes as it is.
  const origin = baseURL ?? new URL(request.url).origin
  const target = new URL(location, origin)
  if (target.origin !== origin) return response
  const finish = new URL('/auth/finish', origin)
  finish.searchParams.set('to', `${target.pathname}${target.search}`)
  response.headers.set('location', finish.toString())
  return response
}
