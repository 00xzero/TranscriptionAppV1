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
import { readAccountMarker } from '@/lib/auth/account-marker'
import { authDiagnostics, type AuthStage } from '@/lib/auth/diagnostics'
import {
  accountChangeFromMarker,
  decideTokenRequest,
  resolveIdentity,
  type AccountChange,
  type AuthSnapshot,
  type Lookup,
} from '@/lib/auth/auth-policy'

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
  /**
   * Set once the browser's session no longer belongs to this page's account
   * (another tab signed out or switched). The page has stopped for good:
   * `user` and `userId` stay the old account's, and nothing more is sent.
   */
  accountChange: AccountChange | null
}

export interface AuthContextValue extends AuthIdentity {
  /**
   * Sign out: leaves the page for `/auth/sign-out`, which ends the WorkOS
   * session and lands on the sign-in page. The page stays as it is until it
   * is replaced, and the promise never settles; callers do nothing after it.
   */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

function displayName(firstName: string | null, lastName: string | null): string | null {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  return name || null
}

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

/** How often a visible page reads the account cookie, besides on focus. */
const ACCOUNT_CHECK_MS = 2_000

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

/** The account a page settled on, for the rest of its life. */
interface PageAccount {
  userId: string
  workosUserId: string
  email: string
  name: string | null
}

/**
 * App-wide owner of client auth identity. WorkOS AuthKit owns the session;
 * this resolves it to our own user id (`current_user_id()`) and registers the
 * token getter for the browser Supabase client.
 *
 * A page belongs to the first account it resolves, for its whole life. The
 * session cookie is shared by every tab, so another tab can sign out or sign
 * in as someone else. This page then never takes on the new account: it
 * stops (`accountChange`), sends nothing more, and the app covers it and asks
 * for a reload (AccountChangedScreen). It learns of the change from the
 * account cookie (account-marker.ts), read before and after every token and
 * whenever the tab is visible; from AuthKit reporting another user; from a
 * token issued for someone else; or from a route answering ACCOUNT_CHANGED.
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
  // Whether AuthKit has read the session since load, and failed reads so far.
  const [sessionRead, setSessionRead] = useState(false)
  const [failedReads, setFailedReads] = useState(0)
  const [account, setAccount] = useState<PageAccount | null>(null)
  const [accountChange, setAccountChange] = useState<AccountChange | null>(null)

  const workosUserId = workosUser?.id ?? null
  const resolved = resolveIdentity(workosUserId, loading, lookup, sessionRead)
  // The first account resolved is this page's for good, so it is settled
  // while rendering: no render ever shows another one.
  if (!account && resolved.userId && workosUser) {
    setAccount({
      userId: resolved.userId,
      workosUserId: workosUser.id,
      email: workosUser.email,
      name: displayName(workosUser.firstName ?? null, workosUser.lastName ?? null),
    })
  }
  const userId = account?.userId ?? resolved.userId
  const ready = Boolean(account) || resolved.ready
  const noUserUnconfirmed = !account && !loading && !workosUserId && !sessionRead
  const readFailing = noUserUnconfirmed && failedReads > 0
  // Reads wait while AuthKit is asking, and while "no user" awaits its first read.
  const authUnknown = !account && (loading || (noUserUnconfirmed && !readFailing))

  const snapshot: AuthSnapshot = {
    workosUserId: account?.workosUserId ?? workosUserId,
    userId,
    readFailing,
    authUnknown,
  }
  const snapshotRef = useRef(snapshot)
  const changeRef = useRef<AccountChange | null>(null)
  const activeRef = useRef(true)
  const readingRef = useRef(false)
  const readDiagnosticsRef = useRef<ReturnType<typeof authDiagnostics> | null>(null)
  const lookupDiagnosticsRef = useRef<{
    workosUserId: string
    report: ReturnType<typeof authDiagnostics>
  } | null>(null)
  const authKnownWaitersRef = useRef(new Set<() => void>())
  const releaseWaiters = useCallback(() => {
    authKnownWaitersRef.current.forEach((release) => release())
    authKnownWaitersRef.current.clear()
  }, [])
  useLayoutEffect(() => {
    snapshotRef.current = snapshot
    if (!snapshot.authUnknown) releaseWaiters()
  })
  useLayoutEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      releaseWaiters()
    }
  }, [releaseWaiters])

  const untilAuthKnown = useCallback(
    () => new Promise<void>((release) => authKnownWaitersRef.current.add(release)),
    []
  )

  /**
   * Stops this page for good: nothing more is sent for its account, and
   * nothing plays. Playback pauses here, before the app unmounts under the
   * cover (CurrentAccountOnly), since a removed media element keeps playing.
   */
  const freeze = useCallback((reason: AccountChange) => {
    if (changeRef.current) return
    changeRef.current = reason
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause())
    setAccountChange(reason)
    releaseWaiters()
    void createClient().realtime.disconnect()
  }, [releaseWaiters])

  /** Whether the page has stopped, reading the account cookie first. */
  const hasStopped = useCallback(() => {
    if (changeRef.current) return true
    const change = accountChangeFromMarker(snapshotRef.current.userId, readAccountMarker(document.cookie))
    if (change) freeze(change)
    return Boolean(change)
  }, [freeze])

  // Layout effects run before any component's data-loading effects, so the
  // first Supabase request already carries the token.
  useLayoutEffect(() => {
    setAccessTokenGetter(async (expectedUserId) => {
      if (hasStopped()) throw new AccountChangedError()
      let decision = decideTokenRequest(snapshotRef.current, expectedUserId, { phase: 'entry' })
      // AuthKit hands out no token before it knows the user.
      if (decision === 'wait-for-auth') {
        await untilAuthKnown()
        if (hasStopped()) throw new AccountChangedError()
        decision = decideTokenRequest(snapshotRef.current, expectedUserId, { phase: 'after-auth-wait' })
      }
      if (decision === 'account-changed') throw new AccountChangedError()
      if (decision === 'no-token') return undefined
      if (decision === 'sign-in-unconfirmed') throw new Error(SIGN_IN_UNCONFIRMED_MESSAGE)
      const token = await getAccessToken()
      if (!activeRef.current) return undefined
      // The account can change while AuthKit is fetching/refreshing its token.
      if (hasStopped()) throw new AccountChangedError()
      const tokenDecision = decideTokenRequest(snapshotRef.current, expectedUserId, {
        phase: 'after-token',
        hasToken: Boolean(token),
        subject: token ? accessTokenSubject(token) : null,
      })
      if (tokenDecision === 'account-changed') throw new AccountChangedError()
      if (tokenDecision === 'use-token') return token
      // Another account's token: the session is no longer this page's.
      if (tokenDecision === 'freeze') {
        freeze('switched')
        throw new AccountChangedError()
      }
      return undefined
    }, () => freeze('switched'))
    return () => setAccessTokenGetter(null)
  }, [getAccessToken, freeze, hasStopped, untilAuthKnown])

  // Once settled, watch for the account changing while nothing is being
  // sent, so the old account's page is covered as soon as anyone looks.
  useEffect(() => {
    if (!account || accountChange) return
    const check = () => {
      if (document.visibilityState === 'visible') hasStopped()
    }
    check()
    const timer = setInterval(check, ACCOUNT_CHECK_MS)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [account, accountChange, hasStopped])

  // AuthKit itself reporting someone else, or no one, after the page settled.
  useEffect(() => {
    if (!account || loading || workosUserId === account.workosUserId) return
    freeze(workosUserId ? 'switched' : 'signed-out')
  }, [account, loading, workosUserId, freeze])

  const readSession = useCallback(() => {
    if (readingRef.current) return
    readingRef.current = true
    const diagnose = readDiagnosticsRef.current ??= authDiagnostics('session-read', TIMED_RETRIES + 1)
    const failed = (error: unknown) => {
      diagnose('failed', error)
      setFailedReads((reads) => reads + 1)
    }
    void refreshAuth()
      .then((result) => {
        if (result && 'error' in result) failed(result.error)
        else {
          diagnose('recovered')
          readDiagnosticsRef.current = null
          setSessionRead(true)
        }
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

  const settled = Boolean(account)
  useEffect(() => {
    if (!workosUserId || settled) return
    if (lookupDiagnosticsRef.current?.workosUserId !== workosUserId) {
      lookupDiagnosticsRef.current = {
        workosUserId,
        report: authDiagnostics('identity', TIMED_RETRIES + 1),
      }
    }
    const diagnose = lookupDiagnosticsRef.current.report
    let stage: AuthStage = 'lookup'
    let current = true
    void (async () => {
      const supabase = createClient()
      const userId = await getCurrentUserId(supabase)
      if (!current) return
      stage = 'token'
      const token = await getSupabaseAccessToken()
      if (!current) return
      if (!token || accessTokenSubject(token) !== workosUserId) throw new AccountChangedError()
      // A channel joins with Realtime's cached token, even when its token
      // callback already returns the new account. Set that cache before
      // exposing this identity to any subscription effects. Passing the
      // validated token also supersedes older in-flight SDK auth callbacks.
      stage = 'realtime'
      await supabase.realtime.setAuth(token)
      if (current) {
        diagnose('recovered', undefined, { stage })
        setLookup({ workosUserId, status: 'resolved', userId })
      }
    })().catch((error) => {
      if (!current) return
      if (!(error instanceof AccountChangedError)) diagnose('failed', error, { stage })
      setLookup((previous) => ({
        status: 'failed',
        ...nextFailures(previous?.status === 'failed' ? previous : null, workosUserId),
      }))
    })
    return () => {
      current = false
    }
  }, [workosUserId, lookupRun, settled])

  // A failed lookup reruns the lookup above, which only counts for the
  // WorkOS user it was made for.
  const failedLookups =
    !settled && lookup?.status === 'failed' && lookup.workosUserId === workosUserId ? lookup.attempt : 0
  const rerunLookup = useCallback(() => setLookupRun((run) => run + 1), [])
  useRetryWhileFailing(failedLookups, rerunLookup)

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

  const email = account?.email ?? ''
  const name = account?.name ?? null
  const value = useMemo<AuthContextValue>(
    () => ({
      user: account ? { email, name } : null,
      userId,
      ready,
      accountChange,
      signOut,
    }),
    [account, userId, ready, email, name, accountChange, signOut]
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
    // AuthKit's own focus check reloads the page when it can't reach the
    // server, losing unsaved work; the account cookie covers what it checks.
    <AuthKitProvider onSessionExpired={false}>
      <AppAuthProvider>{children}</AppAuthProvider>
    </AuthKitProvider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
