import 'server-only'

import { saveSession, type Session } from '@workos-inc/authkit-nextjs'
import type { AuthenticationResponse } from '@workos-inc/node'
import { createAdminClient } from '@/infra/supabase/admin'
import { markAccount } from './account-marker.server'
import { finishUrl, redirectUri } from './origin.server'
import { provisionAppUser } from './provision-app-user.server'
import { authDiagnostics } from './diagnostics'

const PROVISION_TRIES = 3

/**
 * The last step of every sign-in, once WorkOS has said yes: make sure the
 * person has an app_users row, and only then write the session cookie, so a
 * failed provisioning never leaves anyone signed in without an account.
 * The account cookie goes with it, so open tabs of another account freeze.
 * Provisioning is safe to repeat, so it is tried a few times first: the
 * WorkOS answer it follows can't be used again (an OAuth code, a verification
 * token), so giving up means the person signs in again.
 *
 * Returns the URL the browser loads next: /auth/finish, which checks the
 * cookie stuck before going on to `next`. Null when it could not finish.
 */
export async function completeSignIn(auth: AuthenticationResponse, next: string): Promise<string | null> {
  const diagnose = authDiagnostics('sign-in-completion', PROVISION_TRIES)
  if (!auth.accessToken || !auth.refreshToken) {
    diagnose('failed', undefined, { stage: 'tokens', category: 'missing-tokens' })
    return null
  }
  let userId: string | null = null
  for (let tries = 1; tries <= PROVISION_TRIES && !userId; tries++) {
    try {
      userId = await provisionAppUser(createAdminClient(), auth.user.id)
    } catch (error) {
      diagnose('failed', error, { stage: 'provisioning' })
    }
  }
  if (!userId) return null
  diagnose('recovered', undefined, { stage: 'provisioning' })

  try {
    await saveSession(sessionOf(auth), redirectUri ?? finishUrl('/'))
    await markAccount(userId)
  } catch (error) {
    diagnose('failed', error, { stage: 'save-session' })
    return null
  }
  return finishUrl(next)
}

/**
 * The part of WorkOS's answer that belongs in the session cookie: the fields
 * AuthKit's own callback saves. saveSession seals whatever it is given, so the
 * provider's own OAuth tokens (Google's, Microsoft's) and anything else in the
 * answer stay out, or the cookie can outgrow the 4 KB browsers keep.
 */
export function sessionOf(auth: AuthenticationResponse): Session {
  const { accessToken, refreshToken, user, impersonator, authenticationMethod } = auth
  return { accessToken, refreshToken, user, impersonator, authenticationMethod }
}
