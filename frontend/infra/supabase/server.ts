/**
 * Supabase client for server-side (RSC, API Routes, Server Actions).
 *
 * Signs every request with the signed-in person's WorkOS access token, which
 * Supabase accepts as a third-party auth provider. The proxy has already
 * refreshed the session, so a request starts with a token that is not yet
 * due for renewal.
 *
 * Route handlers pass `refreshSession: true` and hold the client with
 * `await using`, so work that outlasts the token (a large delete) renews it on
 * time rather than failing midway. Leaving the scope stops renewing and waits
 * for a renewal under way, so its session cookie goes out with the response.
 * A Server Component must not renew: renewing uses up the refresh token at
 * WorkOS, and a Server Component cannot write the new session cookie, so the
 * session would be lost.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { refreshSession, withAuth } from '@workos-inc/authkit-nextjs'
import { accessTokenTimes } from '@/infra/workos/access-token'
import { renewAccountMark } from '@/lib/auth/account-marker.server'
import { authDiagnostics } from '@/lib/auth/diagnostics'

// A refresh token is single-use, but WorkOS answers a reuse within 30 seconds
// of its first use with that same new pair. The browser and the proxy renew
// with the request's refresh token at AuthKit's lead (below). Renewing this
// much earlier, on a timer rather than when the next call happens to ask,
// keeps this request within 30 seconds of them, so all of them end up with
// one pair however long the route's calls, or the work between them, take.
const RENEW_AHEAD_OF_AUTHKIT_SECONDS = 20
// After a renewal that failed for a moment, well within that 30 seconds.
const RETRY_AFTER_MS = 5_000

export type RenewingSupabaseClient = SupabaseClient & AsyncDisposable

export async function createClient(options: { refreshSession: true }): Promise<RenewingSupabaseClient>
export async function createClient(options?: { refreshSession?: false }): Promise<SupabaseClient>
export async function createClient({ refreshSession: canRenew = false }: { refreshSession?: boolean } = {}) {
    // Use SUPABASE_URL for server-side (Docker), fallback to NEXT_PUBLIC for browser
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) throw new Error('Missing environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')

    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseAnonKey) throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY')

    const auth = await withAuth()
    const workosUserId = auth.user?.id ?? null
    let accessToken = auth.accessToken ?? null
    // One renewal at a time: parallel requests share it. A renewal WorkOS
    // refused for good is not tried again; the token is kept as it is.
    let renewal: Promise<void> | null = null
    let renewalRefused = false
    let stopped = !canRenew || !workosUserId
    let timer: ReturnType<typeof setTimeout> | undefined
    const diagnose = authDiagnostics('renewal')

    const renew = async (): Promise<'renewed' | 'retry' | 'refused'> => {
        try {
            // Reads the request's session cookie. If the proxy already renewed
            // this request, the token is fresh and this is not reached until
            // the proxy's renewal is past WorkOS's 30 seconds; then it fails
            // and the request carries on with the token it has.
            const refreshed = await refreshSession()
            // Only ever the same person's token.
            if (refreshed.user?.id === workosUserId && refreshed.accessToken) {
                accessToken = refreshed.accessToken
                diagnose('recovered')
                // The session cookie's lifetime started again; the account
                // cookie's goes with it. Failing that does not undo the renewal.
                await renewAccountMark().catch((error) =>
                    authDiagnostics('renewal')('failed', error, { stage: 'save-session' }))
                return 'renewed'
            }
            diagnose('refused', undefined, { category: 'session-mismatch' })
            return 'refused'
        } catch (error) {
            diagnose('failed', error, { category: isTransient(error) ? 'transient' : 'refused' })
            // A network blip or WorkOS outage may pass.
            return isTransient(error) ? 'retry' : 'refused'
        }
    }

    const startRenewal = () =>
        (renewal ??= renew().then((outcome) => {
            renewal = null
            if (outcome === 'refused') renewalRefused = true
            schedule(outcome === 'retry' ? RETRY_AFTER_MS : undefined)
        }))

    // Renews when the token is due, whether or not a call is under way.
    function schedule(delayMs?: number) {
        clearTimeout(timer)
        if (stopped || renewalRefused || !accessToken) return
        const times = accessTokenTimes(accessToken)
        if (!times) return
        timer = setTimeout(startRenewal, delayMs ?? Math.max(0, renewalDueAt(times) - Date.now()))
        timer.unref?.()
    }
    schedule()

    const client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => {
            // The timer may run late on a busy server.
            if (!stopped && !renewalRefused && accessToken && dueForRenewal(accessToken)) startRenewal()
            if (renewal) await renewal
            return accessToken
        },
    })
    if (!canRenew) return client
    return Object.assign(client, {
        async [Symbol.asyncDispose]() {
            stopped = true
            clearTimeout(timer)
            await renewal
        },
    })
}

function dueForRenewal(token: string): boolean {
    const times = accessTokenTimes(token)
    return times !== null && renewalDueAt(times) <= Date.now()
}

function renewalDueAt(times: { issuedAt: number | null; expiresAt: number }): number {
    return (times.expiresAt - authkitRenewalLead(times) - RENEW_AHEAD_OF_AUTHKIT_SECONDS) * 1000
}

// How long before expiry the browser's AuthKit and the proxy renew a token
// (AuthKit 4.5.0): 30 seconds for tokens of up to 5 minutes, else 60.
function authkitRenewalLead({ issuedAt, expiresAt }: { issuedAt: number | null; expiresAt: number }): number {
    const lifetime = expiresAt - (issuedAt ?? expiresAt)
    return lifetime <= 300 ? 30 : 60
}

// AuthKit's TokenRefreshError says whether WorkOS refused the refresh token
// for good or could not be reached.
function isTransient(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'isTransient' in error && error.isTransient === true
}
