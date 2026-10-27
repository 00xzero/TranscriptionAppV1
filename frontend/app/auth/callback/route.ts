/**
 * Auth callback route for WorkOS AuthKit.
 *
 * WorkOS redirects here after sign-in; AuthKit exchanges the code for a
 * session and returns the person to the page they asked for. The first
 * sign-in of a WorkOS user creates its app_users row. If that fails, AuthKit
 * clears the new session, so nobody is left signed in without an account.
 *
 * A failed callback goes where lib/auth/sign-in-recovery.server.ts says: a
 * stale attempt is started again once, a person still signed in goes to the
 * Library, and anything else ends on /auth/error, which offers to try again.
 */
import { handleAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/infra/supabase/admin'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'
import { recoverFromSignInError, type SignInRecovery } from '@/lib/auth/sign-in-recovery.server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined

export const GET = handleAuth({
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
    if (recovery.kind === 'restart') return NextResponse.redirect(recovery.url)
    const path = recovery.kind === 'home' ? '/' : '/auth/error'
    return NextResponse.redirect(new URL(path, baseURL ?? request.url))
  },
})
