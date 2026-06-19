"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getOwnerClientId,
  getPresence,
  PRESENCE_STALE_MS,
  type RecordingPresence,
} from './presence'
import { getOwnerLock } from './lock'
import { useAuthIdentity } from '@/lib/supabase/hooks'

/**
 * Derived same-browser remote-recording status for the current tab. This is a
 * pure read model — it never mutates recording state. The owner-loss → recovery
 * side effect lives in `RecordingSessionProvider`, which consumes this status.
 */
export type RemotePresenceStatus =
  | { kind: 'checking' }
  | { kind: 'none' }
  | {
      kind: 'active'
      sessionId: string
      title: string | null
      state: RecordingPresence['state']
      startedAt: number
      lastResumeAt: number | null
      pausedAccumulatedMs: number
    }
  /** Lock is held but heartbeat is stale/absent or belongs to another user. */
  | { kind: 'lock-only' }
  /** A same-user recording lost its owner tab; valid chunks may be recoverable. */
  | { kind: 'owner-lost'; sessionId: string }

const CHECKING_STATUS: RemotePresenceStatus = { kind: 'checking' }
const NONE_STATUS: RemotePresenceStatus = { kind: 'none' }
const LOCK_ONLY_STATUS: RemotePresenceStatus = { kind: 'lock-only' }

export function isRemoteRecordingBlockingKind(
  kind: RemotePresenceStatus['kind']
): boolean {
  return kind === 'active' || kind === 'lock-only'
}

export function isRemoteRecordingBlocking(status: RemotePresenceStatus): boolean {
  return isRemoteRecordingBlockingKind(status.kind)
}

function safeRead(): RecordingPresence | null {
  try {
    return getPresence().read()
  } catch {
    return null
  }
}

/**
 * @param localActive whether THIS tab owns an active/recoverable recording. When
 * true the tab is (or is resolving) the owner, so it never shows a remote state.
 */
/**
 * Owner-lock liveness query result, keyed to the exact presence snapshot it was
 * run for (`sessionId:heartbeatAt`, or `absent`). Keying matters: a `free` result
 * from a PRIOR presence must never be applied to a newer stale presence, or we
 * could declare owner-lost (and kick recovery) on a still-alive owner before the
 * fresh query completes. A result whose key ≠ the current presence key is
 * treated as unconfirmed (conservative `lock-only`).
 */
interface LockResult {
  key: string
  status: 'held' | 'free'
}

function presenceKey(presence: RecordingPresence | null): string {
  return presence ? `${presence.sessionId}:${presence.heartbeatAt}` : 'absent'
}

export function useRemotePresence(localActive: boolean): RemotePresenceStatus {
  const identity = useAuthIdentity()
  // Keep the first render SSR/hydration-stable while telling route effects not to
  // make "no remote owner" decisions until the browser-only read below completes.
  const [presence, setPresence] = useState<RecordingPresence | null>(null)
  const [presenceChecked, setPresenceChecked] = useState(false)
  const [lockResult, setLockResult] = useState<LockResult | null>(null)
  // A non-owner tab has no recording interval, so re-read the snapshot and the
  // current time on a timer to re-evaluate staleness. `now` lives in state (rather
  // than `Date.now()` in render) so the render stays pure.
  const [now, setNow] = useState(() => Date.now())

  const updatePresence = useCallback(() => {
    setPresence(safeRead())
    setPresenceChecked(true)
    setNow(Date.now())
  }, [])

  useEffect(() => {
    updatePresence()
    const unsubscribe = getPresence().subscribe(updatePresence)
    return unsubscribe
  }, [updatePresence])

  const heartbeatAt = presence?.heartbeatAt ?? null
  const fresh = heartbeatAt != null && now - heartbeatAt < PRESENCE_STALE_MS
  const key = presenceKey(presence)

  // Fresh heartbeats arrive via BroadcastChannel/storage events. If those events
  // stop, wake exactly when the snapshot becomes stale instead of polling every
  // 2s while the owner appears healthy.
  useEffect(() => {
    if (heartbeatAt == null || !fresh) return
    const staleInMs = Math.max(0, heartbeatAt + PRESENCE_STALE_MS - now + 1)
    const id = window.setTimeout(updatePresence, staleInMs)
    return () => {
      window.clearTimeout(id)
    }
  }, [fresh, heartbeatAt, now, updatePresence])

  const shouldPollLock = !fresh && (presence != null || lockResult?.status === 'held')

  useEffect(() => {
    if (!shouldPollLock) return
    const id = window.setInterval(updatePresence, 2_000)
    return () => {
      window.clearInterval(id)
    }
  }, [shouldPollLock, updatePresence])

  // When the heartbeat is fresh, the owner is obviously alive — skip the lock
  // query. Otherwise confirm liveness against the owner lock, tagging the result
  // with the current presence key so it only applies to this exact snapshot.
  useEffect(() => {
    if (fresh) return
    let cancelled = false
    getOwnerLock()
      .isHeld()
      .then((held) => {
        if (!cancelled) setLockResult({ key, status: held ? 'held' : 'free' })
      })
      .catch(() => {
        // On a query failure be conservative: treat the owner as alive so we
        // never declare owner-lost (and probe) without a confirmed free lock.
        if (!cancelled) setLockResult({ key, status: 'held' })
      })
    return () => {
      cancelled = true
    }
  }, [fresh, key, now])

  const usable =
    presence != null &&
    !!identity.userId &&
    presence.userId === identity.userId

  // Stale/absent/foreign heartbeat: lock liveness decides — but only a result keyed
  // to the CURRENT presence counts; a stale-keyed result is treated as unconfirmed.
  const liveness = lockResult && lockResult.key === key ? lockResult.status : 'unknown'

  return useMemo(() => {
    if (!presenceChecked && !localActive) return CHECKING_STATUS
    if (localActive) return NONE_STATUS
    if (presence && presence.ownerClientId === getOwnerClientId()) {
      return NONE_STATUS
    }

    if (usable && fresh && presence) {
      return {
        kind: 'active',
        sessionId: presence.sessionId,
        title: presence.title,
        state: presence.state,
        startedAt: presence.startedAt,
        lastResumeAt: presence.lastResumeAt,
        pausedAccumulatedMs: presence.pausedAccumulatedMs,
      }
    }

    // A fresh heartbeat from another user in this browser still represents a live
    // same-browser owner. Keep details private, but show/block generically.
    if (presence && fresh) return LOCK_ONLY_STATUS

    if (liveness === 'held') return LOCK_ONLY_STATUS
    // Liveness not yet confirmed: never emit owner-lost on an unconfirmed lock.
    // Show the conservative "another tab" state while we have usable metadata;
    // otherwise keep callers in the neutral checking state until the lock query
    // confirms whether an owner exists.
    if (liveness === 'unknown') {
      return usable ? LOCK_ONLY_STATUS : CHECKING_STATUS
    }
    // Confirmed free for this exact presence.
    if (usable && presence) {
      return { kind: 'owner-lost', sessionId: presence.sessionId }
    }
    return NONE_STATUS
  }, [fresh, liveness, localActive, presence, presenceChecked, usable])
}
