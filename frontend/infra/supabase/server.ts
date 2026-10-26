/**
 * Supabase client for server-side (RSC, API Routes, Server Actions).
 *
 * Signs every request with the signed-in person's WorkOS access token, which
 * Supabase accepts as a third-party auth provider. The proxy has already
 * refreshed the session, so the token is read once per client.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { withAuth } from '@workos-inc/authkit-nextjs'

export async function createClient() {
    // Use SUPABASE_URL for server-side (Docker), fallback to NEXT_PUBLIC for browser
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) throw new Error('Missing environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')

    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseAnonKey) throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY')

    const { accessToken } = await withAuth()

    return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => accessToken ?? null,
    })
}
