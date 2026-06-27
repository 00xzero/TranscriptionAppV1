import React from 'react'
import { act, render } from '@testing-library/react'

let identityValue: { userId: string | null; ready: boolean } = {
  userId: 'u1',
  ready: true,
}

jest.mock('@/lib/supabase/hooks', () => ({
  useAuthIdentity: () => identityValue,
}))

jest.mock('@/lib/recording/session', () => ({
  ...jest.requireActual('@/lib/recording/session'),
  runRecoveryProbe: jest.fn(async () => false),
}))

import { RecordingSessionProvider } from '@/lib/recording/RecordingSessionContext'
import { __resetForTesting, runRecoveryProbe } from '@/lib/recording/session'
import { getIdentity } from '@/lib/recording/sessionIdentity'
import {
  FakeRecordingPresence,
  __setPresenceForTesting,
  __setOwnerClientIdForTesting,
  type RecordingPresence,
} from '@/lib/recording/presence'
import { FakeOwnerLock, __setOwnerLockForTesting } from '@/lib/recording/lock'

const NOW = 100_000
const mockProbe = jest.mocked(runRecoveryProbe)

function presence(over: Partial<RecordingPresence> = {}): RecordingPresence {
  return {
    sessionId: 's1',
    ownerClientId: 'tab-other',
    userId: 'u1',
    state: 'recording',
    title: 'Orphan',
    startedAt: NOW - 20_000,
    lastResumeAt: NOW - 20_000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 4096,
    lastChunkSeq: 5,
    lastChunkReceivedAt: NOW - 1_000,
    heartbeatAt: NOW - 1_000,
    ...over,
  }
}

const flush = () => act(async () => {})

describe('owner-loss → recovery probe (provider)', () => {
  let channel: FakeRecordingPresence

  beforeEach(() => {
    __resetForTesting()
    identityValue = { userId: 'u1', ready: true }
    mockProbe.mockClear()
    mockProbe.mockResolvedValue(false)
    channel = new FakeRecordingPresence()
    __setPresenceForTesting(channel)
    __setOwnerLockForTesting(new FakeOwnerLock(false)) // owner lock NOT held
    __setOwnerClientIdForTesting('tab-me')
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    __setPresenceForTesting(null)
    __setOwnerLockForTesting(null)
    __setOwnerClientIdForTesting(null)
  })

  test('a same-user owner-loss probes exactly once, even across re-renders', async () => {
    // Start with a fresh (active) remote recording: only the startup probe runs.
    channel.publish(presence())
    const { rerender } = render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    await flush()
    const afterStartup = mockProbe.mock.calls.length // startup probe
    expect(afterStartup).toBeGreaterThanOrEqual(1)

    // The owner tab dies: heartbeat goes stale and the owner lock is not held.
    await act(async () => {
      channel.publish(presence({ heartbeatAt: NOW - 60_000 }))
    })
    await flush()
    expect(mockProbe.mock.calls.length).toBe(afterStartup + 1)
    expect(channel.read()).toBeNull()

    // Re-renders after the dead presence is cleared must not re-fire the probe.
    rerender(<RecordingSessionProvider>y</RecordingSessionProvider>)
    await flush()
    expect(mockProbe.mock.calls.length).toBe(afterStartup + 1)
  })

  test('does not clear a newer presence while an old owner-loss probe resolves', async () => {
    channel.publish(presence())
    render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    await flush()
    mockProbe.mockClear()

    let resolveProbe: (found: boolean) => void = () => {}
    mockProbe.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve
        })
    )

    await act(async () => {
      channel.publish(presence({ sessionId: 's1', heartbeatAt: NOW - 60_000 }))
    })
    expect(mockProbe).toHaveBeenCalledTimes(1)

    await act(async () => {
      channel.publish(presence({ sessionId: 's2', heartbeatAt: NOW - 1_000 }))
      resolveProbe(false)
    })
    await flush()

    expect(channel.read()?.sessionId).toBe('s2')
  })

  test('retries owner-loss recovery after a transient probe failure', async () => {
    jest.useFakeTimers()
    try {
      channel.publish(presence())
      render(<RecordingSessionProvider>x</RecordingSessionProvider>)
      await flush()
      mockProbe.mockClear()
      mockProbe
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce(false)

      await act(async () => {
        channel.publish(presence({ heartbeatAt: NOW - 60_000 }))
      })
      await flush()
      expect(mockProbe).toHaveBeenCalledTimes(1)
      expect(channel.read()?.sessionId).toBe('s1')

      await act(async () => {
        jest.advanceTimersByTime(2_000)
      })
      await flush()

      expect(mockProbe).toHaveBeenCalledTimes(2)
      expect(channel.read()).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('does not probe for owner-loss of another user', async () => {
    channel.publish(presence({ userId: 'someone-else', heartbeatAt: NOW - 60_000 }))
    render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    await flush()
    // Only the startup probe (for u1) may run; the foreign owner-loss must not add one.
    const calls = mockProbe.mock.calls.length
    await act(async () => {
      channel.publish(presence({ userId: 'someone-else', heartbeatAt: NOW - 61_000 }))
    })
    await flush()
    expect(mockProbe.mock.calls.length).toBe(calls)
  })

  test('owner-loss probe sees the current recording identity seam', async () => {
    const seenIdentities: Array<ReturnType<typeof getIdentity>> = []
    mockProbe.mockImplementation(async () => {
      seenIdentities.push(getIdentity())
      return false
    })

    channel.publish(presence({ heartbeatAt: NOW - 60_000 }))
    render(<RecordingSessionProvider>x</RecordingSessionProvider>)
    await flush()

    expect(seenIdentities).toContainEqual({ ready: true, userId: 'u1' })
  })
})
