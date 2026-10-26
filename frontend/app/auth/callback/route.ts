/**
 * Auth callback route for WorkOS AuthKit.
 *
 * WorkOS redirects here after sign-in; AuthKit exchanges the code for a
 * session and returns the person to the page they asked for. The first
 * sign-in of a WorkOS user creates its app_users row. If that fails, AuthKit
 * clears the new session and shows its error page, so nobody is left signed
 * in without an account.
 */
import { handleAuth } from '@workos-inc/authkit-nextjs'
import { createAdminClient } from '@/infra/supabase/admin'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI

export const GET = handleAuth({
  baseURL: redirectUri ? new URL(redirectUri).origin : undefined,
  onSuccess: async ({ user }) => {
    await provisionAppUser(createAdminClient(), { id: user.id, email: user.email })
  },
})
