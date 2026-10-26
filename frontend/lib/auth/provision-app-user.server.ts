import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export interface WorkosIdentity {
  id: string
  email: string
}

/**
 * Our UUID for a WorkOS user, creating its app_users row on first sign-in.
 *
 * Safe under concurrent sign-ins: the insert is ON CONFLICT DO NOTHING on the
 * unique workos_user_id, and the id is then read back, so every sign-in of
 * one identity resolves to the same row. Accounts are never linked by email:
 * an account made before WorkOS is linked by its id, by hand.
 */
export async function provisionAppUser(
  admin: SupabaseClient,
  identity: WorkosIdentity
): Promise<string> {
  const { error: insertError } = await admin
    .from('app_users')
    .upsert(
      { workos_user_id: identity.id, email: identity.email },
      { onConflict: 'workos_user_id', ignoreDuplicates: true }
    )
  if (insertError) throw insertError

  const { data, error } = await admin
    .from('app_users')
    .select('id')
    .eq('workos_user_id', identity.id)
    .single()
  if (error) throw error
  return data.id as string
}
