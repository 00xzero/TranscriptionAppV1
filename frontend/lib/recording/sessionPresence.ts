/**
 * Owner-side same-browser presence: publishes the live session's presence
 * snapshot and runs the tick-driven heartbeat so other tabs can observe the
 * recording. Read-only consumers (remote tabs) live in `useRemotePresence`; this
 * module is the publisher half, owned by the recording tab.
 */

import { setTickObserver, store } from './sessionStore'
import { getIdentity } from './sessionIdentity'
import {
  getOwnerClientId,
  getPresence,
  HEARTBEAT_INTERVAL_MS,
  isRecordingPresenceState,
  type RecordingPresence,
} from './presence'

// Clear same-browser presence, swallowing errors (best-effort).
export function clearPresenceQuietly(): void {
  try {
    getPresence().clear()
  } catch {
    // ignore — best-effort
  }
}

// Wall-clock of the last presence publish, used to throttle the heartbeat to
// HEARTBEAT_INTERVAL_MS even though the driving tick is 1s.
let lastPresencePublishAt = 0

// Publish the current session's presence snapshot for same-browser tabs. No-op
// unless the session is in an active state with a resolved user — presence must
// never carry key terms or the upload intent id (it lives in localStorage).
export function publishPresence(): void {
  const snap = store.snapshot
  const sessionId = store.runtime.sessionId
  const userId = getIdentity().userId
  if (!sessionId || !userId) return
  if (!isRecordingPresenceState(snap.state)) return

  const nextSeq = store.runtime.nextChunkSeq
  const presence: RecordingPresence = {
    sessionId,
    ownerClientId: getOwnerClientId(),
    userId,
    state: snap.state,
    title: snap.title ?? snap.generatedTitle,
    startedAt: snap.startedAt ?? Date.now(),
    lastResumeAt: snap.lastResumeAt,
    pausedAccumulatedMs: snap.pausedAccumulatedMs,
    bytesSoFar: store.runtime.bytesSoFar,
    lastChunkSeq: nextSeq > 0 ? nextSeq - 1 : null,
    lastChunkReceivedAt: store.runtime.lastChunkReceivedAt,
    heartbeatAt: Date.now(),
  }
  lastPresencePublishAt = presence.heartbeatAt
  try {
    getPresence().publish(presence)
  } catch {
    // best-effort
  }
}

// Tick-driven heartbeat: republish presence every HEARTBEAT_INTERVAL_MS so remote
// tabs can tell the owner tab is still alive. Driven by the 1s recording interval.
// Exported for deterministic tests (mirrors checkCaptureHealth).
export function heartbeatTick(now: number = Date.now()): void {
  if (!store.runtime.sessionId) return
  if (!isRecordingPresenceState(store.snapshot.state)) return
  if (now - lastPresencePublishAt < HEARTBEAT_INTERVAL_MS) return
  publishPresence()
}

// Test hook: reset the heartbeat throttle so a publish timestamp from a prior test
// cannot suppress the next session's first heartbeat.
export function __resetPresenceThrottle(): void {
  lastPresencePublishAt = 0
}

// Drive the presence heartbeat from the 1s recording interval tick. Keyed
// registration keeps dev HMR idempotent when this module re-evaluates while the
// sessionStore module survives.
setTickObserver('presence-heartbeat', () => heartbeatTick())
