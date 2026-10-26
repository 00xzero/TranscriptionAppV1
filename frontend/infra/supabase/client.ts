/**
 * Supabase client for browser-side (Client Components).
 *
 * One shared client, signed with the WorkOS access token from
 * `infra/workos/access-token.ts`. supabase-js asks for the token on every
 * database, storage and realtime request, so a refreshed token is picked up
 * without recreating the client. Sign-in itself is AuthKit's: with
 * `accessToken` set, `supabase.auth` is unavailable.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAccessToken } from '@/infra/workos/access-token'

let browserClient: SupabaseClient | null = null

export function createClient(): SupabaseClient {
    if (browserClient) return browserClient

    browserClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: getAccessToken }
    )
    return browserClient
}

/** A capture keeps its original owner even if the shared session changes later. */
export function createClientForUser(userId: string): SupabaseClient {
    return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: () => getAccessToken(userId) }
    )
}
