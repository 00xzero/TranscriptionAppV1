/**
 * Supabase client for browser-side (Client Components).
 *
 * Uses @supabase/ssr for cookie-based authentication.
 */
import { createBrowserClient } from '@supabase/ssr'
import { getBrowserSupabaseCookieName } from './cookie'

export function createClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const cookieName = getBrowserSupabaseCookieName(supabaseUrl)

    return createBrowserClient(
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: {
                // Reuse legacy cookies when present, otherwise keep a stable local name.
                name: cookieName,
            }
        }
    )
}
