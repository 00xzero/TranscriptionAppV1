/** @jest-environment node */

import {
  accountChangeFromMarker,
  decideTokenRequest,
  resolveIdentity,
  type AuthSnapshot,
  type Lookup,
  type TokenCheckpoint,
} from '@/lib/auth/auth-policy'

describe('resolveIdentity', () => {
  const resolved: Lookup = { workosUserId: 'workos-a', status: 'resolved', userId: 'app-a' }
  const unprovisioned: Lookup = { ...resolved, userId: null }
  const failed: Lookup = { workosUserId: 'workos-a', status: 'failed', attempt: 1 }
  const unknown = { userId: null, ready: false }
  const signedOut = { userId: null, ready: true }

  test.each<{
    name: string
    workosUserId: string | null
    loading: boolean
    lookup: Lookup | null
    sessionRead: boolean
    expected: { userId: string | null; ready: boolean }
  }>([
    { name: 'initial loading', workosUserId: null, loading: true, lookup: null, sessionRead: false, expected: unknown },
    { name: 'unconfirmed no-user answer', workosUserId: null, loading: false, lookup: resolved, sessionRead: false, expected: unknown },
    { name: 'confirmed signed out ignores an old lookup', workosUserId: null, loading: false, lookup: resolved, sessionRead: true, expected: signedOut },
    { name: 'loading remains unresolved after a prior session read', workosUserId: null, loading: true, lookup: null, sessionRead: true, expected: unknown },
    { name: 'current lookup resolves the app user', workosUserId: 'workos-a', loading: false, lookup: resolved, sessionRead: false, expected: { userId: 'app-a', ready: true } },
    { name: 'current lookup takes precedence over loading', workosUserId: 'workos-a', loading: true, lookup: resolved, sessionRead: false, expected: { userId: 'app-a', ready: true } },
    { name: 'unprovisioned user is signed out', workosUserId: 'workos-a', loading: false, lookup: unprovisioned, sessionRead: true, expected: signedOut },
    { name: 'unprovisioned lookup also takes precedence over loading', workosUserId: 'workos-a', loading: true, lookup: unprovisioned, sessionRead: true, expected: signedOut },
    { name: 'old account’s lookup cannot resolve a replacement', workosUserId: 'workos-b', loading: false, lookup: resolved, sessionRead: true, expected: unknown },
    { name: 'pending lookup stays unresolved', workosUserId: 'workos-a', loading: false, lookup: null, sessionRead: true, expected: unknown },
    { name: 'failed lookup stays unresolved', workosUserId: 'workos-a', loading: false, lookup: failed, sessionRead: true, expected: unknown },
  ])('$name', ({ workosUserId, loading, lookup, sessionRead, expected }) => {
    if (lookup) Object.freeze(lookup)
    expect(resolveIdentity(workosUserId, loading, lookup, sessionRead)).toEqual(expected)
  })
})

const known: AuthSnapshot = Object.freeze({
  workosUserId: 'workos-a',
  userId: 'app-a',
  readFailing: false,
  authUnknown: false,
})

const entry: TokenCheckpoint = { phase: 'entry' }
const afterWait: TokenCheckpoint = { phase: 'after-auth-wait' }
const tokenFor = (subject: string | null): TokenCheckpoint => ({ phase: 'after-token', hasToken: true, subject })
const noToken: TokenCheckpoint = { phase: 'after-token', hasToken: false, subject: null }
const signedOut = { workosUserId: null, userId: null }

type Row = {
  name: string
  state?: Partial<AuthSnapshot>
  expected?: string
  at: TokenCheckpoint
  decision: ReturnType<typeof decideTokenRequest>
}

// A bound request for another account is refused first, at every checkpoint.
const boundary = [entry, afterWait, tokenFor('workos-a')].flatMap((at): Row[] => [
  { name: `a different expected app user, at ${at.phase}`, expected: 'app-b', at, decision: 'account-changed' },
  { name: `a bound request while the app user is unresolved, at ${at.phase}`, state: { userId: null, authUnknown: true }, expected: 'app-a', at, decision: 'account-changed' },
  { name: `a bound request while the session read fails, at ${at.phase}`, state: { ...signedOut, readFailing: true }, expected: 'app-a', at, decision: 'account-changed' },
])

const rows: Row[] = [
  ...boundary,
  { name: 'a known account, unbound', at: entry, decision: 'fetch-token' },
  { name: 'a known account, bound', expected: 'app-a', at: entry, decision: 'fetch-token' },
  { name: 'an empty expected id is unbound', expected: '', at: entry, decision: 'fetch-token' },
  { name: 'confirmed signed out may still ask AuthKit', state: signedOut, at: entry, decision: 'fetch-token' },
  { name: 'auth unknown waits on entry', state: { ...signedOut, authUnknown: true }, at: entry, decision: 'wait-for-auth' },
  { name: 'a released request never waits again (including release on unmount)', state: { ...signedOut, authUnknown: true }, at: afterWait, decision: 'fetch-token' },
  { name: 'a failing session read on entry', state: { ...signedOut, readFailing: true }, at: entry, decision: 'sign-in-unconfirmed' },
  { name: 'a failing session read after the wait', state: { ...signedOut, readFailing: true }, at: afterWait, decision: 'sign-in-unconfirmed' },
  { name: 'a token for the current WorkOS user, unbound', at: tokenFor('workos-a'), decision: 'use-token' },
  { name: 'a token for the current WorkOS user, bound', expected: 'app-a', at: tokenFor('workos-a'), decision: 'use-token' },
  { name: 'no token from AuthKit, unbound', at: noToken, decision: 'no-token' },
  { name: 'no token from AuthKit, bound', expected: 'app-a', at: noToken, decision: 'no-token' },
  { name: 'a foreign subject', at: tokenFor('workos-b'), decision: 'freeze' },
  { name: 'an unreadable subject', at: tokenFor(null), decision: 'freeze' },
  { name: 'a foreign subject on a bound request, before the provider rejects it', expected: 'app-a', at: tokenFor('workos-b'), decision: 'freeze' },
  { name: 'a token without a current WorkOS user', state: signedOut, at: tokenFor('workos-a'), decision: 'no-token' },
  { name: 'an unreadable token without a current WorkOS user', state: signedOut, at: tokenFor(null), decision: 'no-token' },
  { name: 'an empty WorkOS id never matches an empty subject', state: { workosUserId: '', userId: null }, at: tokenFor(''), decision: 'no-token' },
  { name: 'no second auth wait after the token', state: { authUnknown: true }, at: tokenFor('workos-a'), decision: 'use-token' },
  { name: 'no session-read failure check after the token', state: { ...signedOut, readFailing: true }, at: tokenFor('workos-a'), decision: 'no-token' },
]

describe('decideTokenRequest', () => {
  test.each(rows)('$name', ({ state, expected, at, decision }) => {
    // Frozen: deciding must not change the snapshot or checkpoint.
    const snapshot: AuthSnapshot = Object.freeze({ ...known, ...state })
    expect(decideTokenRequest(snapshot, expected, Object.freeze({ ...at }))).toBe(decision)
  })
})

describe('accountChangeFromMarker', () => {
  test.each<[string, string | null, string | null, ReturnType<typeof accountChangeFromMarker>]>([
    ['a page not settled yet ignores the cookie', null, 'app-b', null],
    ['the same account', 'app-a', 'app-a', null],
    ['another account signed in', 'app-a', 'app-b', 'switched'],
    ['signed out in another tab', 'app-a', 'none', 'signed-out'],
    ['a session from before the cookie existed', 'app-a', null, 'sign-in-again'],
  ])('%s', (_name, pageUserId, marker, expected) => {
    expect(accountChangeFromMarker(pageUserId, marker)).toBe(expected)
  })
})
