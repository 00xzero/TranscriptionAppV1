/** Pure identity and token decisions; AuthProvider owns their effects and timing. */

type ResolvedIdentity = { userId: string | null; ready: boolean }

const INITIAL_IDENTITY: ResolvedIdentity = { userId: null, ready: false }
const SIGNED_OUT_IDENTITY: ResolvedIdentity = { userId: null, ready: true }

/** The outcome of resolving one WorkOS user to our own user id. */
export type Lookup =
  | { workosUserId: string; status: 'resolved'; userId: string | null }
  | { workosUserId: string; status: 'failed'; attempt: number }

export function resolveIdentity(
  workosUserId: string | null,
  loading: boolean,
  lookup: Lookup | null,
  staleFor: string | null,
  sessionRead: boolean
): ResolvedIdentity {
  // AuthKit's first check found no one, which it also answers when the check
  // fails: unknown until a read that reports failures confirms it.
  if (!loading && !workosUserId && !sessionRead) return INITIAL_IDENTITY
  // The session now belongs to someone else (another tab changed accounts):
  // nothing is known until AuthKit reports the session's user.
  if (workosUserId && staleFor === workosUserId) return INITIAL_IDENTITY
  // A lookup only counts for the WorkOS user it was made for, so one that
  // finishes after sign-out or an account switch is never shown.
  if (workosUserId && lookup?.workosUserId === workosUserId && lookup.status === 'resolved') {
    // A WorkOS user with no app_users row has no account here yet.
    return lookup.userId ? { userId: lookup.userId, ready: true } : SIGNED_OUT_IDENTITY
  }
  if (loading) return INITIAL_IDENTITY
  if (!workosUserId) return SIGNED_OUT_IDENTITY
  // Still looking up, or the lookup failed: identity is unknown, not signed out.
  return INITIAL_IDENTITY
}

export type AuthSnapshot = Readonly<{
  workosUserId: string | null
  userId: string | null
  staleFor: string | null
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
  | 'reconcile-session'

export function decideTokenRequest(
  snapshot: AuthSnapshot,
  expectedUserId: string | undefined,
  checkpoint: TokenCheckpoint
): TokenDecision {
  const sessionIsStale = Boolean(
    snapshot.workosUserId && snapshot.staleFor === snapshot.workosUserId
  )
  if (expectedUserId && (snapshot.userId !== expectedUserId || sessionIsStale)) {
    return 'account-changed'
  }
  if (sessionIsStale) return 'no-token'

  if (checkpoint.phase === 'after-token') {
    // Two missing identities must never count as a matching session.
    if (!checkpoint.hasToken || !snapshot.workosUserId) return 'no-token'
    return checkpoint.subject === snapshot.workosUserId ? 'use-token' : 'reconcile-session'
  }
  // An unmount also releases waiters: a released request must not wait again.
  if (checkpoint.phase === 'entry' && snapshot.authUnknown) return 'wait-for-auth'
  if (snapshot.readFailing) return 'sign-in-unconfirmed'
  return 'fetch-token'
}
