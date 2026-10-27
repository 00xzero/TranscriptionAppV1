/**
 * Auth callback route for WorkOS AuthKit.
 *
 * WorkOS redirects here after sign-in; AuthKit exchanges the code for a
 * session and returns the person to the page they asked for. The first
 * sign-in of a WorkOS user creates its app_users row. If that fails, AuthKit
 * clears the new session, so nobody is left signed in without an account.
 *
 * Any failure (a stale or reused link, a missing PKCE cookie, a cancelled
 * sign-in, provisioning) ends on /auth/error, which offers to try again. It
 * never goes straight back to sign-in: WorkOS would sign the person in again
 * at once and a failure that repeats would loop. A visitor who is still
 * signed in is sent on to the Library by the proxy instead.
 */
import { handleAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/infra/supabase/admin'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined

export const GET = handleAuth({
  baseURL,
  onSuccess: async ({ user }) => {
    await provisionAppUser(createAdminClient(), { id: user.id, email: user.email })
  },
  // AuthKit has already logged the error; only the page is ours.
  onError: ({ request }) => NextResponse.redirect(new URL('/auth/error', baseURL ?? request.url)),
})
