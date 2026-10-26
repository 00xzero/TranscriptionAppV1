/**
 * Browser access-token source for the Supabase client.
 *
 * AuthKit only hands out its token through a React hook, while the browser
 * Supabase client is a module singleton. AuthProvider registers a getter
 * here; the client asks for a token on every request, so it always gets a
 * fresh one (AuthKit refreshes before expiry). No getter, or no signed-in
 * user, means the request goes out with only the anon key.
 */
import { AccountChangedError } from '@/lib/auth/account-boundary'

type AccessTokenGetter = (expectedUserId?: string) => Promise<string | undefined>

let getter: AccessTokenGetter | null = null
let accountChanged: (() => void) | null = null

export function setAccessTokenGetter(
    next: AccessTokenGetter | null,
    onAccountChanged: (() => void) | null = null
): void {
    getter = next
    accountChanged = onAccountChanged
}

export async function getAccessToken(expectedUserId?: string): Promise<string | null> {
    if (!getter) {
        if (expectedUserId) throw new AccountChangedError()
        return null
    }
    const token = (await getter(expectedUserId)) ?? null
    // An account-bound write must never fall back to an anonymous request.
    if (expectedUserId && !token) throw new AccountChangedError()
    return token
}

/** The server saw a different cookie account; reconcile, without retrying the write. */
export function notifyAccountChanged(): void {
    accountChanged?.()
}

/**
 * The WorkOS user a token was issued for (its `sub`), read without
 * verifying it: only to tell which session a token belongs to, never to
 * trust it. Supabase verifies every token it receives. Null when the token
 * is not a readable JWT.
 */
export function accessTokenSubject(token: string): string | null {
    const payload = token.split('.')[1]
    if (!payload) return null
    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
        const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
        return typeof json.sub === 'string' ? json.sub : null
    } catch {
        return null
    }
}
