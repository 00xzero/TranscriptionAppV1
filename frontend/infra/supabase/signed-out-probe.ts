/**
 * Development only: records every browser Supabase request that went out
 * without a signed-in token. supabase-js sends the anon key in place of a
 * missing token, so those are the requests RLS answers as signed out (an
 * empty library, a transcript "not found"). Every app page needs a signed-in
 * person, so on them the list should stay empty.
 *
 * Read it in the console: `window.__signedOutSupabaseRequests`.
 */

export interface SignedOutRequest {
    url: string
    /** Milliseconds since the page started loading. */
    at: number
}

declare global {
    interface Window {
        __signedOutSupabaseRequests?: SignedOutRequest[]
    }
}

export function withSignedOutProbe(anonKey: string): typeof fetch | undefined {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return undefined
    const signedOut = (window.__signedOutSupabaseRequests ??= [])
    return (input, init) => {
        const authorization = new Headers(init?.headers).get('Authorization')
        if (authorization === `Bearer ${anonKey}`) {
            const url = input instanceof Request ? input.url : String(input)
            signedOut.push({ url, at: Math.round(performance.now()) })
            console.warn('[auth] Supabase request sent signed out:', url)
        }
        return fetch(input, init)
    }
}
