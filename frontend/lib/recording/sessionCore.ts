/**
 * Transition kernel + shared session primitives.
 *
 * This is the layer the orchestration modules (upload, recovery) and the
 * recorder lifecycle all build on: snapshot selectors, the `dispatch` funnel and
 * its ordered transition-effect table, the generic transition wrappers, the
 * best-effort lock-release helpers, and ordered terminal cleanup. It depends only
 * on the low-level store/runtime/transitions and the presence publisher; it never
 * imports upload, recovery, or the lifecycle module, which keeps the dependency
 * graph acyclic.
 */

import { getOwnerLock, getSessionLock } from './lock'
import { clearPresenceQuietly, publishPresence } from './sessionPresence'
import {
  clearInterruptedSessionRuntime,
  clearTerminalSessionRuntime,
  disposeController,
  getLiveRecorderFromStore,
} from './sessionRuntime'
import {
  clearIntervalIfRunning,
  clearMockLifecycleTimeouts,
  clearSessionActivity,
  setSnapshot,
  startIntervalIfNeeded,
  store,
} from './sessionStore'
import {
  TRANSITION_SPECS,
  canTransition,
  isInFlightState,
  isRetryableError,
  type SnapshotTransitionAction,
} from './sessionTransitions'
import { IDLE_SNAPSHOT, type SessionSnapshot } from './sessionTypes'

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------

export function getLiveRecorder(): MediaRecorder | null {
  return getLiveRecorderFromStore(store)
}

export function getElapsedActiveMs(
  snap: SessionSnapshot,
  now: number = Date.now()
): number {
  return Math.max(0, snap.pausedAccumulatedMs + getActiveSegmentMs(snap, now))
}

export function getActiveSegmentMs(
  snap: SessionSnapshot,
  now: number = Date.now()
): number {
  return snap.state === 'recording' && snap.lastResumeAt != null
    ? Math.max(0, now - snap.lastResumeAt)
    : 0
}

// A capture is "in flight" — recording, finishing, uploading, or finished but
// holding a recording that can still be retried. Used both to guard against
// starting a second capture and to warn before navigating away.
export function isRecordingSessionActive(snapshot: SessionSnapshot): boolean {
  return isInFlightState(snapshot.state) || isRetryableError(snapshot)
}

export function hasUnsavedRecording(): boolean {
  return isRecordingSessionActive(store.snapshot)
}

// Auth/context boundary guard (Phase 3): sign-out and account/workspace switches
// are blocked until the user resolves any active, recoverable, or retryable
// recording artifact. Broader than `hasUnsavedRecording` because `recoverable`
// audio is already persisted but must still be saved/transcribed or discarded
// before leaving the user/context it belongs to.
export function hasUnresolvedRecordingArtifact(): boolean {
  return (
    isRecordingSessionActive(store.snapshot) ||
    store.snapshot.state === 'recoverable'
  )
}

// ----------------------------------------------------------------------------
// Lock release + terminal cleanup
// ----------------------------------------------------------------------------

// Release session ownership, swallowing errors. Lock release is always
// best-effort: a failed release must never block a terminal/recovery flow.
export async function releaseSessionLockQuietly(): Promise<void> {
  try {
    await getSessionLock().release()
  } catch {
    // ignore — best-effort
  }
}

// Release the global per-browser owner lock, swallowing errors (best-effort).
export async function releaseOwnerLockQuietly(): Promise<void> {
  try {
    await getOwnerLock().release()
  } catch {
    // ignore — best-effort
  }
}

// Terminal live-session cleanup is ordered: clear/delete local persistence first,
// then clear presence, then release ownership — so another tab never sees "no
// owner" while chunks still exist, and cannot briefly claim chunks this tab is
// deleting (especially important for discard).
export async function finalizeTerminalCleanup(): Promise<void> {
  await clearTerminalSessionRuntime(store, clearSessionActivity)
  clearPresenceQuietly()
  await releaseSessionLockQuietly()
  await releaseOwnerLockQuietly()
}

// Persist pause/resume timing from the POST-transition snapshot. `dispatch()`
// folds `pausedAccumulatedMs` and clears/sets `lastResumeAt` inside setSnapshot,
// so reading before it returns would persist stale values.
function persistTimingPatch(): void {
  store.runtime.writeQueue?.enqueueMetadata({
    pausedAccumulatedMs: store.snapshot.pausedAccumulatedMs,
    lastResumeAt: store.snapshot.lastResumeAt,
  })
}

// ----------------------------------------------------------------------------
// Transition dispatch funnel
//
// Every state transition runs through `dispatch`: it guards via the pure state
// machine, runs the transition's ordered before-effects, applies the snapshot,
// then its after-effects. The effects live in one ordered table per action, so
// the ordering is structural rather than encoded in call order across sites.
// ----------------------------------------------------------------------------

function buildTransitionSnapshot(
  snap: SessionSnapshot,
  action: SnapshotTransitionAction,
  patch: Partial<SessionSnapshot> = {},
  now: number = Date.now()
): SessionSnapshot {
  const { target, foldsElapsedTime } = TRANSITION_SPECS[action]
  const foldedMs = foldsElapsedTime ? getActiveSegmentMs(snap, now) : 0

  return {
    ...snap,
    ...patch,
    state: target,
    ...(target !== 'recording' ? { lastResumeAt: null } : {}),
    ...(foldsElapsedTime
      ? { pausedAccumulatedMs: snap.pausedAccumulatedMs + foldedMs }
      : {}),
  }
}

type TransitionEffect = () => void
interface TransitionEffects {
  before?: TransitionEffect[]
  after?: TransitionEffect[]
}

const pauseController: TransitionEffect = () => {
  store.runtime.controller?.pause()
}
const resumeController: TransitionEffect = () => {
  store.runtime.controller?.resume()
}
const resetFlushRequested: TransitionEffect = () => {
  store.runtime.flushRequested = false
}
const rebaselineChunkClock: TransitionEffect = () => {
  store.runtime.lastChunkReceivedAt = Date.now()
}
const beginTerminalCleanup: TransitionEffect = () => {
  void finalizeTerminalCleanup()
}
const releaseOwnershipIfNonRetryable: TransitionEffect = () => {
  // Non-retryable errors have no recoverable artifact, so drop the public
  // presence and release ownership. Retryable upload errors intentionally keep
  // the last presence snapshot as a recovery breadcrumb (finalizedRecording !=
  // null): if this tab dies while parked on the error, other tabs can map the
  // released owner lock back to the lost session id and run recovery.
  if (store.runtime.finalizedRecording == null) {
    clearPresenceQuietly()
    void releaseOwnerLockQuietly()
  }
}
const disposeLiveController: TransitionEffect = () => {
  disposeController(store)
}
const beginInterruptedTeardown: TransitionEffect = () => {
  clearInterruptedSessionRuntime(store, clearSessionActivity)
}

// Ordered side effects per transition, split around `setSnapshot`. `satisfies`
// keeps this exhaustive over every SnapshotTransitionAction. `publishPresence` is
// in every after-list (it self-no-ops outside recording-presence states) so
// remote tabs reflect pause/resume/finalize/upload promptly, not only on the next
// heartbeat tick. Phase 4: the 1s interval keeps running through recording →
// paused → finalizing → uploading for the heartbeat; it is stopped only on
// terminal cleanup, error, and interrupted.
const TRANSITION_EFFECTS = {
  pause: {
    before: [pauseController],
    after: [publishPresence, resetFlushRequested, persistTimingPatch],
  },
  resume: {
    before: [resumeController],
    // Rebaseline before publishing so same-browser presence reflects the fresh
    // capture-health baseline established by resume.
    after: [
      startIntervalIfNeeded,
      rebaselineChunkClock,
      publishPresence,
      resetFlushRequested,
      persistTimingPatch,
    ],
  },
  finalize: { after: [publishPresence] },
  // markUploading restarts the interval (no-op when already running) so a retry
  // re-entering from the parked error state republishes the upload heartbeat.
  markUploading: { before: [startIntervalIfNeeded], after: [publishPresence] },
  markSubmitted: { before: [beginTerminalCleanup], after: [publishPresence] },
  discard: { before: [beginTerminalCleanup], after: [publishPresence] },
  markError: {
    before: [
      clearIntervalIfRunning,
      clearMockLifecycleTimeouts,
      releaseOwnershipIfNonRetryable,
      disposeLiveController,
    ],
    after: [publishPresence],
  },
  markInterrupted: { before: [beginInterruptedTeardown], after: [publishPresence] },
} satisfies Record<SnapshotTransitionAction, TransitionEffects>

export function dispatch(
  action: SnapshotTransitionAction,
  patch?: Partial<SessionSnapshot>
): boolean {
  const prev = store.snapshot
  if (!canTransition(prev.state, action)) return false
  const effects: TransitionEffects = TRANSITION_EFFECTS[action]
  effects.before?.forEach((effect) => effect())
  setSnapshot(buildTransitionSnapshot(prev, action, patch))
  effects.after?.forEach((effect) => effect())
  return true
}

// ----------------------------------------------------------------------------
// Generic transition wrappers + shared snapshot mutation
// ----------------------------------------------------------------------------

export function pause(): void {
  dispatch('pause', { captureHealthWarning: null })
}

export function resume(): void {
  // The flush-reset, capture-health rebaseline, and timing-persist effects live
  // in the resume transition's after-list (see TRANSITION_EFFECTS). Re-baselining
  // capture health on resume stops a long pause from registering as a capture
  // stall the instant recording resumes (no chunk has arrived yet).
  dispatch('resume', { lastResumeAt: Date.now(), captureHealthWarning: null })
}

export function finalize(): void {
  dispatch('finalize', { captureHealthWarning: null })
}

export function markUploading(): void {
  dispatch('markUploading')
}

export function setSubmissionResult(
  result: SessionSnapshot['submissionResult']
): void {
  setSnapshot({ ...store.snapshot, submissionResult: result })
}

export function markSubmitted(): void {
  dispatch('markSubmitted', { recoverable: null })
}

export function discard(salvageMessage?: string): void {
  dispatch('discard', { salvageMessage: salvageMessage ?? null })
}

export function markError(message: string): void {
  dispatch('markError', { errorMessage: message })
}

export function resetRecordingSession(): void {
  void finalizeTerminalCleanup()
  setSnapshot({ ...IDLE_SNAPSHOT })
}
