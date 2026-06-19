import { act, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import type { BrowserOwnerLock } from '@/lib/recording/lock'

let identityValue: { userId: string | null; ready: boolean } = {
  userId: 'u1',
  ready: true,
}

jest.mock('@/lib/supabase/hooks', () => ({
  useAuthIdentity: () => identityValue,
}))

import { useRemotePresence } from '@/lib/recording/useRemotePresence'
import {
  FakeRecordingPresence,
  __setPresenceForTesting,
  __setOwnerClientIdForTesting,
  type RecordingPresence,
} from '@/lib/recording/presence'
import { FakeOwnerLock, __setOwnerLockForTesting } from '@/lib/recording/lock'

const NOW = 100_000

function presence(over: Partial<RecordingPresence> = {}): RecordingPresence {
  return {
    sessionId: 's1',
    ownerClientId: 'tab-other',
    userId: 'u1',
    state: 'recording',
    title: 'Remote title',
    startedAt: NOW - 10_000,
    lastResumeAt: NOW - 10_000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 1024,
    lastChunkSeq: 2,
    lastChunkReceivedAt: NOW - 1_000,
    heartbeatAt: NOW - 1_000, // fresh
    ...over,
  }
}

async function renderStatus(localActive = false) {
  const view = renderHook(() => useRemotePresence(localActive))
  // Flush the async owner-lock liveness check.
  await act(async () => {})
  return view
}

describe('useRemotePresence', () => {
  let channel: FakeRecordingPresence
  let ownerLock: FakeOwnerLock

  beforeEach(() => {
    identityValue = { userId: 'u1', ready: true }
    channel = new FakeRecordingPresence()
    ownerLock = new FakeOwnerLock(false)
    __setPresenceForTesting(channel)
    __setOwnerLockForTesting(ownerLock)
    __setOwnerClientIdForTesting('tab-me')
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    __setPresenceForTesting(null)
    __setOwnerLockForTesting(null)
    __setOwnerClientIdForTesting(null)
  })

  test('fresh same-user foreign presence ⇒ active', async () => {
    channel.publish(presence())
    const { result } = await renderStatus()
    expect(result.current).toMatchObject({
      kind: 'active',
      sessionId: 's1',
      title: 'Remote title',
      state: 'recording',
    })
  })

  test('server render starts in checking so route effects wait for the first read', () => {
    channel.publish(presence())

    function Status() {
      return <span>{useRemotePresence(false).kind}</span>
    }

    expect(renderToString(<Status />)).toContain('<span>checking</span>')
  })

  test('suppresses our own presence ⇒ none', async () => {
    channel.publish(presence({ ownerClientId: 'tab-me' }))
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('none')
  })

  test('suppressed while this tab is the local owner ⇒ none', async () => {
    channel.publish(presence())
    const { result } = await renderStatus(true)
    expect(result.current.kind).toBe('none')
  })

  test('fresh foreign userId is shown only as generic lock-only', async () => {
    channel.publish(presence({ userId: 'someone-else', heartbeatAt: NOW - 1_000 }))
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('lock-only')
  })

  test('stale foreign userId with no held lock ⇒ none', async () => {
    channel.publish(presence({ userId: 'someone-else', heartbeatAt: NOW - 60_000 }))
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('none')
  })

  test('stale heartbeat but lock still held ⇒ lock-only (lock wins)', async () => {
    ownerLock = new FakeOwnerLock(true)
    __setOwnerLockForTesting(ownerLock)
    channel.publish(presence({ heartbeatAt: NOW - 60_000 }))
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('lock-only')
  })

  test('stale heartbeat and lock not held ⇒ owner-lost', async () => {
    channel.publish(presence({ heartbeatAt: NOW - 60_000 }))
    const { result } = await renderStatus()
    expect(result.current).toMatchObject({ kind: 'owner-lost', sessionId: 's1' })
  })

  test('a free result for a prior presence does not leak owner-lost onto a newer one', async () => {
    // Gate isHeld so we can resolve it on demand and control which presence each
    // query result is keyed to.
    let resolveHeld: ((held: boolean) => void) | null = null
    const gatedLock: BrowserOwnerLock = {
      acquire: async () => true,
      isHeld: () =>
        new Promise<boolean>((resolve) => {
          resolveHeld = resolve
        }),
      release: async () => {},
    }
    __setOwnerLockForTesting(gatedLock)

    // First presence (s1) is stale; its query resolves free → owner-lost.
    channel.publish(presence({ sessionId: 's1', heartbeatAt: NOW - 60_000 }))
    const view = renderHook(() => useRemotePresence(false))
    await act(async () => {
      resolveHeld?.(false)
    })
    expect(view.result.current).toMatchObject({ kind: 'owner-lost', sessionId: 's1' })

    // A NEW owner (s2) starts and is also stale before its query resolves. The old
    // s1 `free` result must not apply — status stays conservative lock-only, never
    // owner-lost for s2, until s2's own query confirms it.
    await act(async () => {
      channel.publish(presence({ sessionId: 's2', heartbeatAt: NOW - 60_000 }))
    })
    expect(view.result.current.kind).toBe('lock-only')

    // s2's query confirms held → stays lock-only (no premature recovery).
    await act(async () => {
      resolveHeld?.(true)
    })
    expect(view.result.current.kind).toBe('lock-only')
  })

  test('never emits owner-lost until the lock query confirms the lock is free', async () => {
    // isHeld never resolves → liveness stays unknown forever.
    const pendingLock: BrowserOwnerLock = {
      acquire: async () => true,
      isHeld: () => new Promise<boolean>(() => {}),
      release: async () => {},
    }
    __setOwnerLockForTesting(pendingLock)
    channel.publish(presence({ heartbeatAt: NOW - 60_000 }))

    const view = renderHook(() => useRemotePresence(false))
    // First synchronous render: stale presence, but liveness is unconfirmed, so it
    // must be the conservative lock-only — never owner-lost.
    expect(view.result.current.kind).toBe('lock-only')
    await act(async () => {})
    expect(view.result.current.kind).toBe('lock-only')
  })

  test('keeps checking while an absent-presence owner-lock query is pending', async () => {
    // No presence can happen after a retryable upload error clears the public
    // snapshot while the owner lock remains held. Until the lock query resolves,
    // route code must not see `none` and redirect away.
    let resolveHeld: ((held: boolean) => void) | null = null
    const gatedLock: BrowserOwnerLock = {
      acquire: async () => true,
      isHeld: () =>
        new Promise<boolean>((resolve) => {
          resolveHeld = resolve
        }),
      release: async () => {},
    }
    __setOwnerLockForTesting(gatedLock)

    const view = renderHook(() => useRemotePresence(false))
    await act(async () => {})
    expect(view.result.current.kind).toBe('checking')

    await act(async () => {
      resolveHeld?.(true)
    })
    expect(view.result.current.kind).toBe('lock-only')
  })

  test('no presence and no lock ⇒ none', async () => {
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('none')
  })

  test('idle tabs do not install the 2s stale-presence poller', async () => {
    const intervalSpy = jest.spyOn(window, 'setInterval')
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('none')
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  test('fresh presence waits for staleness instead of installing the 2s poller', async () => {
    const intervalSpy = jest.spyOn(window, 'setInterval')
    channel.publish(presence())
    const { result } = await renderStatus()
    expect(result.current.kind).toBe('active')
    expect(intervalSpy).not.toHaveBeenCalled()
  })
})
