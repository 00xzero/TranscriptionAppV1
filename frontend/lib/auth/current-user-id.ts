import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Our UUID for whoever signs this client's requests, or null when signed out
 * or not provisioned. For code outside React; components read
 * `useAuth().userId` instead. Throws when the lookup itself fails, so a
 * network error is never mistaken for being signed out.
 */
export async function getCurrentUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_user_id')
  if (error) throw error
  return typeof data === 'string' ? data : null
}
