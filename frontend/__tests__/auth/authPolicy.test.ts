/** @jest-environment node */

import {
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
    staleFor: string | null
    sessionRead: boolean
    expected: { userId: string | null; ready: boolean }
  }>([
    { name: 'initial loading', workosUserId: null, loading: true, lookup: null, staleFor: null, sessionRead: false, expected: unknown },
    { name: 'unconfirmed no-user answer', workosUserId: null, loading: false, lookup: resolved, staleFor: null, sessionRead: false, expected: unknown },
    { name: 'confirmed signed out ignores an old lookup', workosUserId: null, loading: false, lookup: resolved, staleFor: null, sessionRead: true, expected: signedOut },
    { name: 'loading remains unresolved after a prior session read', workosUserId: null, loading: true, lookup: null, staleFor: null, sessionRead: true, expected: unknown },
    { name: 'quarantine overrides a resolved lookup', workosUserId: 'workos-a', loading: false, lookup: resolved, staleFor: 'workos-a', sessionRead: true, expected: unknown },
    { name: 'quarantine overrides an unprovisioned lookup', workosUserId: 'workos-a', loading: false, lookup: unprovisioned, staleFor: 'workos-a', sessionRead: true, expected: unknown },
    { name: 'current lookup resolves the app user', workosUserId: 'workos-a', loading: false, lookup: resolved, staleFor: null, sessionRead: false, expected: { userId: 'app-a', ready: true } },
    { name: 'current lookup takes precedence over loading', workosUserId: 'workos-a', loading: true, lookup: resolved, staleFor: null, sessionRead: false, expected: { userId: 'app-a', ready: true } },
    { name: 'another user’s quarantine does not hide this account', workosUserId: 'workos-a', loading: false, lookup: resolved, staleFor: 'workos-b', sessionRead: true, expected: { userId: 'app-a', ready: true } },
    { name: 'unprovisioned user is signed out', workosUserId: 'workos-a', loading: false, lookup: unprovisioned, staleFor: null, sessionRead: true, expected: signedOut },
    { name: 'unprovisioned lookup also takes precedence over loading', workosUserId: 'workos-a', loading: true, lookup: unprovisioned, staleFor: null, sessionRead: true, expected: signedOut },
    { name: 'old account’s lookup cannot resolve a replacement', workosUserId: 'workos-b', loading: false, lookup: resolved, staleFor: null, sessionRead: true, expected: unknown },
    { name: 'pending lookup stays unresolved', workosUserId: 'workos-a', loading: false, lookup: null, staleFor: null, sessionRead: true, expected: unknown },
    { name: 'failed lookup stays unresolved', workosUserId: 'workos-a', loading: false, lookup: failed, staleFor: null, sessionRead: true, expected: unknown },
  ])('$name', ({ workosUserId, loading, lookup, staleFor, sessionRead, expected }) => {
    if (lookup) Object.freeze(lookup)
    expect(resolveIdentity(workosUserId, loading, lookup, staleFor, sessionRead)).toEqual(expected)
  })
})

const known: AuthSnapshot = Object.freeze({
  workosUserId: 'workos-a',
  userId: 'app-a',
  staleFor: null,
  readFailing: false,
  authUnknown: false,
})

function snapshot(overrides: Partial<AuthSnapshot> = {}): AuthSnapshot {
  return Object.freeze({ ...known, ...overrides })
}

const checkpoints: TokenCheckpoint[] = [
  { phase: 'entry' },
  { phase: 'after-auth-wait' },
  { phase: 'after-token', hasToken: true, subject: 'workos-a' },
]

describe.each(checkpoints)('token account boundary at $phase', (checkpoint) => {
  test('rejects a different expected app user before other decisions', () => {
    expect(decideTokenRequest(known, 'app-b', checkpoint)).toBe('account-changed')
  })

  test('rejects a bound request while the app user is unresolved', () => {
    expect(decideTokenRequest(snapshot({ userId: null, authUnknown: true }), 'app-a', checkpoint))
      .toBe('account-changed')
  })

  test('rejects a bound request before reporting an unconfirmed session read', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null, readFailing: true }), 'app-a', checkpoint))
      .toBe('account-changed')
  })

  test('rejects a quarantined bound account even when its app id still matches', () => {
    expect(decideTokenRequest(snapshot({ staleFor: 'workos-a' }), 'app-a', checkpoint))
      .toBe('account-changed')
  })

  test('withholds a token from a quarantined unbound request', () => {
    expect(decideTokenRequest(snapshot({ staleFor: 'workos-a' }), undefined, checkpoint)).toBe('no-token')
  })
})

describe('token checkpoint decisions', () => {
  test.each([undefined, 'app-a'])('fetches a token for a known account (expected %s)', (expected) => {
    expect(decideTokenRequest(known, expected, { phase: 'entry' })).toBe('fetch-token')
  })

  test('waits on entry while auth is unknown', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null, authUnknown: true }), undefined, { phase: 'entry' }))
      .toBe('wait-for-auth')
  })

  test('does not wait again after release, including release on unmount', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null, authUnknown: true }), undefined, { phase: 'after-auth-wait' }))
      .toBe('fetch-token')
  })

  test.each(['entry', 'after-auth-wait'] as const)('fails an unconfirmed read at %s', (phase) => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null, readFailing: true }), undefined, { phase }))
      .toBe('sign-in-unconfirmed')
  })

  test('preserves the empty expected-id bypass', () => {
    expect(decideTokenRequest(known, '', { phase: 'entry' })).toBe('fetch-token')
  })

  test('another user’s quarantine does not block token retrieval', () => {
    expect(decideTokenRequest(snapshot({ staleFor: 'workos-b' }), 'app-a', { phase: 'entry' }))
      .toBe('fetch-token')
  })

  test('a confirmed signed-out request may still ask AuthKit for a token', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null }), undefined, { phase: 'entry' }))
      .toBe('fetch-token')
  })

  test.each([undefined, 'app-a'])('accepts a token for the current WorkOS user (expected %s)', (expected) => {
    expect(decideTokenRequest(known, expected, { phase: 'after-token', hasToken: true, subject: 'workos-a' }))
      .toBe('use-token')
  })

  test.each([undefined, 'app-a'])('returns no token when AuthKit supplies none (expected %s)', (expected) => {
    expect(decideTokenRequest(known, expected, { phase: 'after-token', hasToken: false, subject: null }))
      .toBe('no-token')
  })

  test.each(['workos-b', null])('reconciles a foreign or unreadable subject: %s', (subject) => {
    expect(decideTokenRequest(known, undefined, { phase: 'after-token', hasToken: true, subject }))
      .toBe('reconcile-session')
  })

  test('a bound request also reconciles before the provider rejects the foreign token', () => {
    expect(decideTokenRequest(known, 'app-a', { phase: 'after-token', hasToken: true, subject: 'workos-b' }))
      .toBe('reconcile-session')
  })

  test.each([null, 'workos-a'])('withholds a present token without a current WorkOS user (subject %s)', (subject) => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null }), undefined, { phase: 'after-token', hasToken: true, subject }))
      .toBe('no-token')
  })

  test('an empty WorkOS id cannot match an empty subject', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: '', userId: null }), undefined, { phase: 'after-token', hasToken: true, subject: '' }))
      .toBe('no-token')
  })

  test('does not start another auth wait after token retrieval', () => {
    expect(decideTokenRequest(snapshot({ authUnknown: true }), undefined, { phase: 'after-token', hasToken: true, subject: 'workos-a' }))
      .toBe('use-token')
  })

  test('does not introduce a session-read failure check after token retrieval', () => {
    expect(decideTokenRequest(snapshot({ workosUserId: null, userId: null, readFailing: true }), undefined, { phase: 'after-token', hasToken: true, subject: 'workos-a' }))
      .toBe('no-token')
  })

  test('does not mutate the snapshot or checkpoint when requesting reconciliation', () => {
    const current = snapshot()
    const checkpoint = Object.freeze({ phase: 'after-token' as const, hasToken: true, subject: 'workos-b' })
    expect(decideTokenRequest(current, 'app-a', checkpoint)).toBe('reconcile-session')
    expect(current).toEqual(known)
    expect(checkpoint).toEqual({ phase: 'after-token', hasToken: true, subject: 'workos-b' })
  })
})
