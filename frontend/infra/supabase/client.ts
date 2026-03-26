/**
 * Supabase client for browser-side (Client Components).
 *
 * Uses @supabase/ssr for cookie-based authentication.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
    const cookieName =
        process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME || 'sb-local-auth-token'

    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: {
                // Use consistent cookie name for local dev (different URLs for client/server in Docker)
                name: cookieName,
            }
        }
    )
}
