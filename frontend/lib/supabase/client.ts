/**
 * Supabase client for browser-side (Client Components).
 * 
 * Uses @supabase/ssr for cookie-based authentication.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: {
                // Use consistent cookie name for local dev (different URLs for client/server in Docker)
                name: 'sb-local-auth-token',
            }
        }
    )
}
