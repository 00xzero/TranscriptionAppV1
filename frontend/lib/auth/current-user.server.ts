import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { withAuth } from '@workos-inc/authkit-nextjs'

export interface CurrentUser {
  /** Our own user id (app_users.id): the owner of rows, files and events. */
  id: string
  email: string
}

/**
 * The signed-in person for an API route, or null (answer 401).
 *
 * WorkOS says who signed in; `current_user_id()` resolves that identity to our
 * UUID through the same client the route then queries with, so the id a
 * route acts on is exactly the one its RLS checks use. A WorkOS user with no
 * app_users row (not provisioned, or a legacy account not yet linked) gets
 * null rather than an id. A lookup that fails throws: an outage is not being
 * signed out, and answering 401 told signed-in people to sign in.
 */
export async function getCurrentUser(supabase: SupabaseClient): Promise<CurrentUser | null> {
  const { user } = await withAuth()
  if (!user) return null

  const { data, error } = await supabase.rpc('current_user_id')
  if (error) throw error
  if (typeof data !== 'string') return null

  return { id: data, email: user.email }
}
