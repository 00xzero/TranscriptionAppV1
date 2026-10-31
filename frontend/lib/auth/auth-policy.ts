/** Pure identity and token decisions; AuthProvider owns their effects and timing. */
import { SIGNED_OUT_MARKER } from './account-marker'

type ResolvedIdentity = { userId: string | null; ready: boolean }

const INITIAL_IDENTITY: ResolvedIdentity = { userId: null, ready: false }
const SIGNED_OUT_IDENTITY: ResolvedIdentity = { userId: null, ready: true }

/** The outcome of resolving one WorkOS user to our own user id. */
export type Lookup =
  | { workosUserId: string; status: 'resolved'; userId: string | null }
  | { workosUserId: string; status: 'failed'; attempt: number }

/**
 * Who the page is for, until it settles on an account. Once it has (see
 * AuthProvider's pinning), this is no longer asked.
 */
export function resolveIdentity(
  workosUserId: string | null,
  loading: boolean,
  lookup: Lookup | null,
  sessionRead: boolean
): ResolvedIdentity {
  // AuthKit's first check found no one, which it also answers when the check
  // fails: unknown until a read that reports failures confirms it.
  if (!loading && !workosUserId && !sessionRead) return INITIAL_IDENTITY
  // A lookup only counts for the WorkOS user it was made for.
  if (workosUserId && lookup?.workosUserId === workosUserId && lookup.status === 'resolved') {
    // A WorkOS user with no app_users row has no account here yet.
    return lookup.userId ? { userId: lookup.userId, ready: true } : SIGNED_OUT_IDENTITY
  }
  if (loading) return INITIAL_IDENTITY
  if (!workosUserId) return SIGNED_OUT_IDENTITY
  // Still looking up, or the lookup failed: identity is unknown, not signed out.
  return INITIAL_IDENTITY
}

/** Why a page stopped: its account is no longer the browser's session. */
export type AccountChange = 'switched' | 'signed-out' | 'sign-in-again'

/**
 * What the account cookie (account-marker.ts) means for a page that settled
 * on `pageUserId`. No cookie while signed in is a session from before the
 * cookie existed: signing in again writes it.
 */
export function accountChangeFromMarker(pageUserId: string | null, marker: string | null): AccountChange | null {
  if (!pageUserId) return null
  if (marker === null) return 'sign-in-again'
  if (marker === SIGNED_OUT_MARKER) return 'signed-out'
  return marker === pageUserId ? null : 'switched'
}

export type AuthSnapshot = Readonly<{
  /** The WorkOS user the page settled on, else AuthKit's current one. */
  workosUserId: string | null
  /** Our user id, once the page has settled on an account. */
  userId: string | null
  readFailing: boolean
  authUnknown: boolean
}>

export type TokenCheckpoint =
  | { phase: 'entry' }
  | { phase: 'after-auth-wait' }
  | { phase: 'after-token'; hasToken: boolean; subject: string | null }

type TokenDecision =
  | 'wait-for-auth'
  | 'fetch-token'
  | 'no-token'
  | 'account-changed'
  | 'sign-in-unconfirmed'
  | 'use-token'
  /** The token is another account's: the page stops. */
  | 'freeze'

/** For a page whose account has not changed; a changed one sends nothing at all. */
export function decideTokenRequest(
  snapshot: AuthSnapshot,
  expectedUserId: string | undefined,
  checkpoint: TokenCheckpoint
): TokenDecision {
  if (expectedUserId && snapshot.userId !== expectedUserId) return 'account-changed'

  if (checkpoint.phase === 'after-token') {
    // Two missing identities must never count as a matching session.
    if (!checkpoint.hasToken || !snapshot.workosUserId) return 'no-token'
    return checkpoint.subject === snapshot.workosUserId ? 'use-token' : 'freeze'
  }
  // An unmount also releases waiters: a released request must not wait again.
  if (checkpoint.phase === 'entry' && snapshot.authUnknown) return 'wait-for-auth'
  if (snapshot.readFailing) return 'sign-in-unconfirmed'
  return 'fetch-token'
}
