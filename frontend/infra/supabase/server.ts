/**
 * Supabase client for server-side (RSC, API Routes, Server Actions).
 *
 * Uses @supabase/ssr with cookie handling for authentication.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
    const cookieStore = await cookies()

    // Use SUPABASE_URL for server-side (Docker), fallback to NEXT_PUBLIC for browser
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) throw new Error('Missing environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')

    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseAnonKey) throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY')

    const cookieName =
        process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME || 'sb-local-auth-token'

    return createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing user sessions.
                    }
                },
            },
            cookieOptions: {
                // Use consistent cookie name for local dev (different URLs for client/server in Docker)
                name: cookieName,
            }
        }
    )
}
