'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AuthKitProvider,
  useAccessToken,
  useAuth as useAuthKit,
} from '@workos-inc/authkit-nextjs/components'
import { createClient } from '@/infra/supabase/client'
import {
  accessTokenSubject,
  getAccessToken as getSupabaseAccessToken,
  setAccessTokenGetter,
} from '@/infra/workos/access-token'
import { getCurrentUserId } from '@/lib/auth/current-user-id'
import { AccountChangedError } from '@/lib/auth/account-boundary'

/** The signed-in person as the app shows them. */
export interface AppUser {
  email: string
  /** Full name from WorkOS, or null when the person has not given one. */
  name: string | null
}

interface AuthIdentity {
  /** Verified user, or null when signed out or not yet verified. */
  user: AppUser | null
  /** Our own user id, once resolved for the WorkOS session. */
  userId: string | null
  /**
   * True once the current auth state is known: a WorkOS session resolved to
   * our user id, or no signed-in user. Privacy-sensitive callers (e.g.
   * recording recovery) must wait for `ready`.
   */
  ready: boolean
}

export interface AuthContextValue extends AuthIdentity {
  /**
   * Sign out: leaves the page for `/auth/sign-out`, which ends the WorkOS
   * session and lands on the sign-in page. The page stays as it is until it
   * is replaced, and the promise never settles; callers do nothing after it.
   */
  signOut: () => Promise<void>
}

type ResolvedIdentity = Pick<AuthIdentity, 'userId' | 'ready'>

const INITIAL_IDENTITY: ResolvedIdentity = { userId: null, ready: false }
const SIGNED_OUT_IDENTITY: ResolvedIdentity = { userId: null, ready: true }

export const AuthContext = createContext<AuthContextValue | null>(null)

function displayName(firstName: string | null, lastName: string | null): string | null {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  return name || null
}

/** The outcome of resolving one WorkOS user to our own user id. */
type Lookup =
  | { workosUserId: string; status: 'resolved'; userId: string | null }
  | { workosUserId: string; status: 'failed'; attempt: number }

/** One failing step's attempts, for the WorkOS user it was made for. */
interface Failures {
  workosUserId: string
  attempt: number
}

function nextFailures(previous: Failures | null, workosUserId: string): Failures {
  return {
    workosUserId,
    attempt: previous?.workosUserId === workosUserId ? previous.attempt + 1 : 1,
  }
}

/** Timed retries of a failing step (1, 2, 4, 8, 16 s); after them, only on reconnect or focus. */
const TIMED_RETRIES = 5

/**
 * Retries a failing step so one network blip doesn't leave the app unresolved
 * until a reload: after each failed `attempt` (0 = not failing), a few times
 * with backoff, then whenever the connection or the tab comes back.
 */
function useRetryWhileFailing(attempt: number, retry: () => void) {
  useEffect(() => {
    if (!attempt) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    const timer = attempt <= TIMED_RETRIES ? setTimeout(retry, 1000 * 2 ** (attempt - 1)) : undefined
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [attempt, retry])
}

/**
 * A request made while the page cannot confirm who is signed in fails with
 * this, rather than going out signed out and reading as an empty library.
 */
export const SIGN_IN_UNCONFIRMED_MESSAGE =
  'Could not confirm you are signed in. Check your connection and try again.'

function resolveIdentity(
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

/**
 * App-wide owner of client auth identity. WorkOS AuthKit owns the session;
 * this resolves it to our own user id (`current_user_id()`) and registers the
 * token getter for the browser Supabase client.
 *
 * The id, the user shown and every request token belong to one session. The
 * session cookie is shared by all tabs, so a token refresh can return another
 * account's token while AuthKit still shows this tab's user. Such a token is
 * never sent: identity goes unresolved (account data clears, recording
 * recovery waits) and AuthKit is asked for the session's user, which then
 * resolves as an account switch. Until it does, the session is checked again
 * with backoff and on reconnect, since an unresolved page makes no requests
 * of its own.
 *
 * Pages are prerendered, so AuthKit learns the user only after the page has
 * loaded, while pages start their reads at once. Until AuthKit knows, the
 * token getter waits rather than letting a read go out signed out; AuthKit
 * then fetches the token for that user.
 *
 * AuthKit's check on load answers "no user" both when no one is signed in
 * and when the check fails. So "no user" counts only once AuthKit has read
 * the session with `refreshAuth`, which reports its failures. Until then
 * reads wait; while that read keeps failing they fail too (an error with
 * Try again, never an empty library), and it is retried.
 */
function AppAuthProvider({ children }: { children: ReactNode }) {
  const { user: workosUser, loading, refreshAuth } = useAuthKit()
  const { getAccessToken } = useAccessToken()
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [lookupRun, setLookupRun] = useState(0)
  const [staleFor, setStaleFor] = useState<string | null>(null)
  const [sessionChecks, setSessionChecks] = useState<Failures | null>(null)
  // Whether AuthKit has read the session since load, and failed reads so far.
  const [sessionRead, setSessionRead] = useState(false)
  const [failedReads, setFailedReads] = useState(0)

  const workosUserId = workosUser?.id ?? null
  const email = workosUser?.email ?? ''
  const name = displayName(workosUser?.firstName ?? null, workosUser?.lastName ?? null)
  const { userId, ready } = resolveIdentity(workosUserId, loading, lookup, staleFor, sessionRead)
  const noUserUnconfirmed = !loading && !workosUserId && !sessionRead
  const readFailing = noUserUnconfirmed && failedReads > 0
  // Reads wait while AuthKit is asking, and while "no user" awaits its first read.
  const authUnknown = loading || (noUserUnconfirmed && !readFailing)

  const workosUserIdRef = useRef(workosUserId)
  const userIdRef = useRef(userId)
  const staleForRef = useRef(staleFor)
  const readFailingRef = useRef(readFailing)
  const authUnknownRef = useRef(authUnknown)
  const refreshingForRef = useRef<{ workosUserId: string } | null>(null)
  const readingRef = useRef(false)
  const authKnownWaitersRef = useRef(new Set<() => void>())
  useLayoutEffect(() => {
    workosUserIdRef.current = workosUserId
    userIdRef.current = userId
    staleForRef.current = staleFor
    readFailingRef.current = readFailing
    authUnknownRef.current = authUnknown
    if (!authUnknown) {
      authKnownWaitersRef.current.forEach((release) => release())
      authKnownWaitersRef.current.clear()
    }
  }, [workosUserId, userId, staleFor, readFailing, authUnknown])
  useLayoutEffect(() => {
    const waiters = authKnownWaitersRef.current
    return () => {
      waiters.forEach((release) => release())
      waiters.clear()
    }
  }, [])

  const untilAuthKnown = useCallback(
    () => new Promise<void>((release) => authKnownWaitersRef.current.add(release)),
    []
  )

  const reconcileSession = useCallback(() => {
    const expected = workosUserIdRef.current
    if (!expected) return
    // Quarantine requests immediately, including before React commits the
    // unresolved identity. A cached token cannot confirm the shared cookie.
    staleForRef.current = expected
    setStaleFor(expected)
    if (refreshingForRef.current?.workosUserId === expected) return

    const attempt = { workosUserId: expected }
    refreshingForRef.current = attempt
    const failed = () => {
      if (refreshingForRef.current === attempt && workosUserIdRef.current === expected) {
        setSessionChecks((checks) => nextFailures(checks, expected))
      }
    }
    void refreshAuth()
      .then((result) => {
        if (result && 'error' in result) {
          failed()
          return
        }
        if (refreshingForRef.current !== attempt) return
        // AuthKit has now read the server session and updated its user. It
        // can confirm a switch to B or a return to A, even with A cached.
        setSessionRead(true)
        setStaleFor((stale) => (stale === expected ? null : stale))
        setSessionChecks((checks) => (checks?.workosUserId === expected ? null : checks))
      })
      .catch(failed)
      .finally(() => {
        if (refreshingForRef.current === attempt) refreshingForRef.current = null
      })
  }, [refreshAuth])

  // Layout effects run before any component's data-loading effects, so the
  // first Supabase request already carries the token.
  useLayoutEffect(() => {
    setAccessTokenGetter(async (expectedUserId) => {
      const sessionIsStale = () => Boolean(
        workosUserIdRef.current && staleForRef.current === workosUserIdRef.current
      )
      const checkAccount = () => {
        if (expectedUserId && (userIdRef.current !== expectedUserId || sessionIsStale())) {
          throw new AccountChangedError()
        }
      }
      checkAccount()
      if (sessionIsStale()) return undefined
      // AuthKit hands out no token before it knows the user.
      if (authUnknownRef.current) {
        await untilAuthKnown()
        checkAccount()
        if (sessionIsStale()) return undefined
      }
      if (readFailingRef.current) throw new Error(SIGN_IN_UNCONFIRMED_MESSAGE)
      const token = await getAccessToken()
      // The account can change while AuthKit is fetching/refreshing its token.
      checkAccount()
      if (sessionIsStale() || !token) return undefined
      const expected = workosUserIdRef.current
      if (expected && accessTokenSubject(token) === expected) return token

      // The token is another session's. Send nothing; ask AuthKit once who
      // the session belongs to now. Failed server checks retry directly;
      // neither a cached token nor a background request clears the mismatch.
      if (!expected) return undefined
      reconcileSession()
      if (expectedUserId) throw new AccountChangedError()
      return undefined
    }, reconcileSession)
    return () => setAccessTokenGetter(null)
  }, [getAccessToken, reconcileSession, untilAuthKnown])

  const readSession = useCallback(() => {
    if (readingRef.current) return
    readingRef.current = true
    const failed = () => setFailedReads((reads) => reads + 1)
    void refreshAuth()
      .then((result) => {
        if (result && 'error' in result) failed()
        else setSessionRead(true)
      })
      .catch(failed)
      .finally(() => {
        readingRef.current = false
      })
  }, [refreshAuth])
  // "No user" from AuthKit's check on load: confirm it with a read, then
  // retry a failing read with backoff and on reconnect.
  useEffect(() => {
    if (noUserUnconfirmed && failedReads === 0) readSession()
  }, [noUserUnconfirmed, failedReads, readSession])
  useRetryWhileFailing(readFailing ? failedReads : 0, readSession)

  useEffect(() => {
    if (!workosUserId) return
    let current = true
    void (async () => {
      const supabase = createClient()
      const userId = await getCurrentUserId(supabase)
      if (!current) return
      const token = await getSupabaseAccessToken()
      if (!current) return
      if (!token || accessTokenSubject(token) !== workosUserId) throw new AccountChangedError()
      // A channel joins with Realtime's cached token, even when its token
      // callback already returns the new account. Set that cache before
      // exposing this identity to any subscription effects. Passing the
      // validated token also supersedes older in-flight SDK auth callbacks.
      await supabase.realtime.setAuth(token)
      if (current) setLookup({ workosUserId, status: 'resolved', userId })
    })().catch(() => {
      if (!current) return
      setLookup((previous) => ({
        status: 'failed',
        ...nextFailures(previous?.status === 'failed' ? previous : null, workosUserId),
      }))
    })
    return () => {
      current = false
    }
  }, [workosUserId, lookupRun])

  // A failed lookup reruns the lookup above, which only counts for the
  // WorkOS user it was made for.
  const failedLookups =
    lookup?.status === 'failed' && lookup.workosUserId === workosUserId ? lookup.attempt : 0
  const rerunLookup = useCallback(() => setLookupRun((run) => run + 1), [])
  useRetryWhileFailing(failedLookups, rerunLookup)

  // Retry the server session check itself. AuthKit can still cache A's token
  // after the server has reported cookie B, so reading that token is not a
  // reconciliation check.
  const failedSessionChecks =
    staleFor && staleFor === workosUserId && sessionChecks?.workosUserId === staleFor
      ? sessionChecks.attempt
      : 0
  useRetryWhileFailing(failedSessionChecks, reconcileSession)

  const signOut = useCallback(() => {
    // A plain form POST: the browser follows the redirects itself, so there
    // is no in-page request to fail while the page leaves. Identity is left
    // as it is: leaving discards all page state anyway, and clearing it
    // first showed the empty signed-out app for the second it takes to go.
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/auth/sign-out'
    form.hidden = true
    document.body.appendChild(form)
    form.submit()
    return new Promise<void>(() => {})
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: userId ? { email, name } : null,
      userId,
      ready,
      signOut,
    }),
    [userId, ready, email, name, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * No `initialAuth` from the server: reading the session while rendering the
 * root layout would stop Next from prerendering any page. AuthKit asks the
 * server for the user once the page has loaded instead.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <AppAuthProvider>{children}</AppAuthProvider>
    </AuthKitProvider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
