import {
  createRecorderController,
} from './recorderController'
import {
  abortUpload,
  clearFinalizedRecording,
  clearInterruptedSessionRuntime,
  clearTerminalSessionRuntime,
  createRuntime,
  disposeController,
  getLiveRecorderFromStore,
} from './sessionRuntime'
import {
  clearIntervalIfRunning,
  clearMockLifecycleTimeouts,
  clearSessionActivity,
  notify,
  setSnapshot,
  setTickObserver,
  startIntervalIfNeeded,
  store,
} from './sessionStore'
import {
  IDLE_SNAPSHOT,
  type AttachAndStartParams,
  type RecoverableInfo,
  type SessionSnapshot,
} from './sessionTypes'
import {
  TRANSITION_SPECS,
  canTransition,
  isInFlightState,
  isRetryableError,
  shouldIgnoreRecorderFailure,
  type SnapshotTransitionAction,
} from './sessionTransitions'
import {
  getPersistence,
  gcExpiredSessions,
  requestPersistentStorage,
  SessionWriteQueue,
  __setPersistenceForTesting,
} from './persistence'
import {
  getSessionLock,
  getOwnerLock,
  __setSessionLockForTesting,
  __setOwnerLockForTesting,
} from './lock'
import {
  getPresence,
  getOwnerClientId,
  HEARTBEAT_INTERVAL_MS,
  isRecordingPresenceState,
  __setPresenceForTesting,
  __setOwnerClientIdForTesting,
  type RecordingPresence,
} from './presence'
import { probeRecoverableSessions } from './recovery'
import { getIdentity, __resetIdentityForTesting } from './sessionIdentity'
import { meetsEmptyFloor, shouldAutoStop } from './sizeBudget'
import { runCaptureUpload } from '@/lib/capture/upload'
import { randomId } from '@/lib/ids'

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

function assertNeverTransitionAction(value: never): never {
  throw new Error(`Unhandled recording snapshot transition action: ${String(value)}`)
}

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

function transition(
  action: SnapshotTransitionAction,
  patch?: Partial<SessionSnapshot>
): boolean {
  const snap = store.snapshot
  if (!canTransition(snap.state, action)) return false

  switch (action) {
    // Phase 4: the 1s interval now runs through recording → paused → finalizing →
    // uploading so the presence heartbeat keeps publishing across the whole active
    // lifecycle. It is stopped only on terminal cleanup, error, and interrupted.
    // `checkCaptureHealth` already no-ops outside `recording`, and the timer
    // freezes on pause via `getActiveSegmentMs`, so keeping it running is safe.
    case 'pause':
      store.runtime.controller?.pause()
      break
    case 'resume':
      store.runtime.controller?.resume()
      break
    case 'finalize':
      break
    case 'markSubmitted':
    case 'discard':
      void finalizeTerminalCleanup()
      break
    case 'markError':
      clearIntervalIfRunning()
      clearMockLifecycleTimeouts()
      if (store.runtime.finalizedRecording == null) {
        // Non-retryable errors have no recoverable artifact, so drop the public
        // presence and release ownership. Retryable upload errors intentionally
        // keep the last presence snapshot as a recovery breadcrumb: if this tab
        // dies while parked on the error, other tabs can map the released owner
        // lock back to the lost session id and run recovery.
        clearPresenceQuietly()
        void releaseOwnerLockQuietly()
      }
      disposeController(store)
      break
    case 'markInterrupted':
      clearInterruptedSessionRuntime(store, clearSessionActivity)
      break
    case 'markUploading':
      // A retry upload re-enters from the error state where the interval was
      // cleared; restart it so the presence heartbeat republishes during upload.
      // No-op when it is already running (the initial finalize → uploading path).
      startIntervalIfNeeded()
      break
    default:
      assertNeverTransitionAction(action)
  }

  setSnapshot(buildTransitionSnapshot(snap, action, patch))

  if (action === 'resume') {
    startIntervalIfNeeded()
  }

  // Push the new state to same-browser presence promptly (not only on the next
  // heartbeat tick) so remote tabs reflect pause/resume/finalize/upload quickly.
  publishPresence()

  return true
}

export class RecordingAlreadyActiveError extends Error {
  readonly code = 'recording_already_active' as const
  constructor() {
    super('A recording is already in progress. Return to it before starting another.')
    this.name = 'RecordingAlreadyActiveError'
  }
}

/**
 * A recording is already live in ANOTHER same-browser tab (the global owner lock
 * is held elsewhere). Distinct from `RecordingAlreadyActiveError`, which is about
 * this tab's own live/unresolved session, so the UI can say "another tab".
 */
export class RemoteRecordingActiveError extends Error {
  readonly code = 'remote_recording_active' as const
  constructor() {
    super('A recording is already in progress in another tab. Return to that tab to continue.')
    this.name = 'RemoteRecordingActiveError'
  }
}

export class RecoveryPendingError extends Error {
  readonly code = 'recovery_pending' as const
  constructor() {
    super('Resolve the recovered recording before starting a new one.')
    this.name = 'RecoveryPendingError'
  }
}

export class RecordingIdentityRequiredError extends Error {
  readonly code = 'recording_identity_required' as const
  constructor() {
    super('Sign in before starting a recording.')
    this.name = 'RecordingIdentityRequiredError'
  }
}

export async function attachAndStart(params: AttachAndStartParams): Promise<void> {
  // A pending recovery must be saved/discarded before a new recording can start.
  if (store.snapshot.state === 'recoverable') {
    throw new RecoveryPendingError()
  }

  // Only one live session is supported. Refuse explicitly so callers can stop
  // the orphaned stream and surface a clear message — silently returning would
  // leak the newly acquired stream and pretend a new recording started.
  if (
    (store.runtime.controller && store.runtime.controller.isAttached()) ||
    hasUnsavedRecording()
  ) {
    throw new RecordingAlreadyActiveError()
  }

  const identity = getIdentity()
  if (!identity.ready || !identity.userId) {
    throw new RecordingIdentityRequiredError()
  }

  // The provider runs this at app startup, but attach is the final backstop:
  // before writing a new session, surface any pending orphan for this user.
  if (await runRecoveryProbe()) {
    throw new RecoveryPendingError()
  }

  clearMockLifecycleTimeouts()
  clearFinalizedRecording(store)

  const persistence = getPersistence()
  const lock = getSessionLock()
  const ownerLock = getOwnerLock()
  const sessionId = randomId('sess-')
  // Distinct from sessionId: the user-scoped upload idempotency key. Generated at
  // start so a session that crashes before stop still carries its dedup key.
  const uploadIntentId = randomId('sess-')

  // Phase 4: take the global per-browser owner lock first. If another same-browser
  // tab already owns a live recording, this fails fast and we never touch the
  // recorder — the caller still owns the stream and releases it.
  const ownerAcquired = await ownerLock.acquire()
  if (!ownerAcquired) {
    throw new RemoteRecordingActiveError()
  }

  // Take ownership of this session before constructing the recorder, so another
  // tab cannot claim it as a recoverable orphan while it is live. On failure the
  // caller still owns the stream (it releases it); we only own the lock here.
  const acquired = await lock.acquire(sessionId)
  if (!acquired) {
    await releaseOwnerLockQuietly()
    throw new RecordingAlreadyActiveError()
  }

  try {
    const controller = createRecorderController(params.stream, params.codec.mime, {
      onChunk: (blob) => recordChunk(blob),
      onError: (reason) => handleRecorderFailure(reason),
      onTrackEnded: () => handleRecorderFailure('Microphone disconnected.'),
      onTrackMutedSustained: () =>
        handleRecorderFailure('Microphone went quiet for too long.'),
    })

    store.runtime.controller = controller
    store.runtime.chunks = []
    store.runtime.bytesSoFar = 0
    store.runtime.acceptingChunks = true
    store.runtime.stopInProgress = false
    store.runtime.deviceId = params.deviceId
    store.runtime.codecMime = params.codec.mime
    store.runtime.maxBytes = params.maxBytes

    // Initialize durable persistence identity BEFORE start(): `acceptingChunks` is
    // already true, so the chunk path is live and a (theoretical) synchronous chunk
    // must find an initialized queue. The session row is only enqueued after start
    // succeeds, so a start failure leaves no orphan row.
    store.runtime.sessionId = sessionId
    store.runtime.uploadIntentId = uploadIntentId
    store.runtime.nextChunkSeq = 0
    store.runtime.lastChunkReceivedAt = null
    store.runtime.flushRequested = false
    store.runtime.writeQueue = new SessionWriteQueue(
      persistence,
      sessionId,
      handleDurabilityDowngrade
    )

    controller.start(1000)
  } catch (err) {
    // Recorder construction/startup are the last synchronous failure points. If
    // either throws, leave the singleton as idle as it was before this attempt
    // and release the lock we just took.
    disposeController(store)
    store.runtime.deviceId = null
    store.runtime.codecMime = null
    store.runtime.maxBytes = 0
    store.runtime.sessionId = null
    store.runtime.uploadIntentId = null
    store.runtime.nextChunkSeq = 0
    store.runtime.writeQueue = null
    void lock.release()
    void releaseOwnerLockQuietly()
    throw err
  }

  const now = Date.now()
  const generatedTitle =
    params.title && params.title.trim()
      ? null
      : `Recording — ${new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(now))}`
  setSnapshot({
    ...IDLE_SNAPSHOT,
    state: 'recording',
    title: params.title,
    generatedTitle,
    startedAt: now,
    lastResumeAt: now,
    pausedAccumulatedMs: 0,
    keyTerms: params.keyTerms,
    codecExtension: params.codec.extension,
    bytesSoFar: 0,
    // Unavailable-from-start detection: a no-op adapter never persists, so the
    // session is unarmed for its whole life and the warning shows immediately.
    durable: persistence.durable,
  })

  // Persist the session row first (queue invariant: putSession is op #0), then
  // best-effort durable-storage request and an opportunistic 7-day GC sweep.
  store.runtime.writeQueue.enqueueSession({
    sessionId,
    userId: identity.userId,
    uploadIntentId,
    title: params.title,
    generatedTitle,
    keyTerms: params.keyTerms,
    codecMime: params.codec.mime,
    codecExtension: params.codec.extension,
    deviceId: params.deviceId,
    createdAt: now,
    startedAt: now,
    lastResumeAt: now,
    pausedAccumulatedMs: 0,
    bytesSoFar: 0,
    lastChunkSeq: null,
    lastChunkReceivedAt: null,
    phase: 'capturing',
    armed: true,
    failureReason: null,
  })
  void requestPersistentStorage()
  void gcExpiredSessions(persistence)

  startIntervalIfNeeded()
  // Announce ownership to same-browser tabs immediately so they reflect the live
  // recording without waiting for the first heartbeat tick.
  publishPresence()
}

/**
 * Patch the live session's persisted row with the resolved user id. Called by the
 * provider when auth identity changes; mostly a defensive/test seam now that
 * attachAndStart requires a resolved user before creating a persisted session.
 * No-op when there is no live session.
 */
export function syncIdentityToActiveSession(userId: string | null): void {
  if (!userId) return
  const queue = store.runtime.writeQueue
  if (!queue) return
  queue.enqueueMetadata({ userId })
}

// Release session ownership, swallowing errors. Lock release is always
// best-effort: a failed release must never block a terminal/recovery flow.
async function releaseSessionLockQuietly(): Promise<void> {
  try {
    await getSessionLock().release()
  } catch {
    // ignore — best-effort
  }
}

// Release the global per-browser owner lock, swallowing errors (best-effort).
async function releaseOwnerLockQuietly(): Promise<void> {
  try {
    await getOwnerLock().release()
  } catch {
    // ignore — best-effort
  }
}

// Clear same-browser presence, swallowing errors (best-effort).
function clearPresenceQuietly(): void {
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
function publishPresence(): void {
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

// Terminal live-session cleanup is ordered: clear/delete local persistence first,
// then clear presence, then release ownership — so another tab never sees "no
// owner" while chunks still exist, and cannot briefly claim chunks this tab is
// deleting (especially important for discard).
async function finalizeTerminalCleanup(): Promise<void> {
  await clearTerminalSessionRuntime(store, clearSessionActivity)
  clearPresenceQuietly()
  await releaseSessionLockQuietly()
  await releaseOwnerLockQuietly()
}

export function pause(): void {
  if (transition('pause', { captureHealthWarning: null })) {
    store.runtime.flushRequested = false
    persistTimingPatch()
  }
}

export function resume(): void {
  if (
    transition('resume', {
      lastResumeAt: Date.now(),
      captureHealthWarning: null,
    })
  ) {
    // Re-baseline capture-health on resume so a long pause does not register as a
    // capture stall the instant recording resumes (no chunk has arrived yet).
    store.runtime.lastChunkReceivedAt = Date.now()
    store.runtime.flushRequested = false
    persistTimingPatch()
  }
}

// Persist pause/resume timing from the POST-transition snapshot. `transition()`
// folds `pausedAccumulatedMs` and clears/sets `lastResumeAt` inside setSnapshot,
// so reading before it returns would persist stale values.
function persistTimingPatch(): void {
  store.runtime.writeQueue?.enqueueMetadata({
    pausedAccumulatedMs: store.snapshot.pausedAccumulatedMs,
    lastResumeAt: store.snapshot.lastResumeAt,
  })
}

// Single-flight, drain-aware Stop. Used by the recording page's controls and
// by the size-budget auto-stop.
export async function stopAndFinalize(): Promise<void> {
  if (store.runtime.stopInProgress) return
  store.runtime.stopInProgress = true

  const controller = store.runtime.controller
  finalize()
  if (!controller) {
    markInterrupted('Recording session was lost before it could be saved.')
    store.runtime.stopInProgress = false
    return
  }

  try {
    try {
      controller.requestData()
    } catch {
      // Best-effort final flush. Some browsers throw if a recorder is already
      // stopping; the stop drain below still handles the normal final chunk.
    }
    await controller.stop()
  } catch {
    // controller errors will route through onError → handleRecorderFailure
  }

  if (
    store.snapshot.state !== 'finalizing' ||
    store.runtime.controller !== controller
  ) {
    store.runtime.stopInProgress = false
    return
  }

  if (typeof window === 'undefined') {
    store.runtime.stopInProgress = false
    return
  }

  if (!meetsEmptyFloor(getElapsedActiveMs(store.snapshot), store.runtime.bytesSoFar)) {
    store.runtime.stopInProgress = false
    discard('Recording discarded before enough audio was captured.')
    return
  }

  const normalizedMime = (store.runtime.codecMime ?? 'audio/webm').split(';')[0]
  const blob = new Blob(store.runtime.chunks, { type: normalizedMime })
  const filename = recordingMediaFilename(
    store.runtime.uploadIntentId,
    store.snapshot.codecExtension
  )
  const file = new File([blob], filename, { type: normalizedMime })
  const persistedTitle =
    store.snapshot.title ??
    store.snapshot.generatedTitle ??
    `Recording — ${new Date().toISOString()}`

  store.runtime.finalizedRecording = {
    file,
    title: persistedTitle,
    keyTerms: store.snapshot.keyTerms,
  }
  store.runtime.chunks = []
  store.runtime.bytesSoFar = 0
  store.runtime.acceptingChunks = false

  try {
    await submitFinalizedRecording()
  } finally {
    store.runtime.stopInProgress = false
  }
}

async function submitFinalizedRecording(): Promise<void> {
  const finalized = store.runtime.finalizedRecording
  if (!finalized) {
    markError('No finalized recording is available to upload.')
    return
  }

  if (!transition('markUploading')) return
  if (store.snapshot.state !== 'uploading') return

  // Persist the phase transition (advisory) after it has applied.
  store.runtime.writeQueue?.enqueueMetadata({ phase: 'uploading' })

  const abortController = new AbortController()
  store.runtime.uploadAbortController = abortController

  let result: Awaited<ReturnType<typeof runCaptureUpload>>
  try {
    result = await runCaptureUpload(
      finalized.file,
      finalized.title,
      finalized.keyTerms,
      {
        signal: abortController.signal,
        uploadIntentId: store.runtime.uploadIntentId ?? undefined,
      }
    )
  } finally {
    if (store.runtime.uploadAbortController === abortController) {
      store.runtime.uploadAbortController = null
    }
  }
  if (abortController.signal.aborted || store.snapshot.state !== 'uploading') {
    return
  }

  if (result.kind === 'success') {
    setSubmissionResult({
      projectId: result.projectId,
      outcome: result.outcome,
    })
    markSubmitted()
  } else {
    markUploadError(result.message)
  }
}

export async function retryFinalizedUpload(): Promise<void> {
  if (store.runtime.stopInProgress) return
  if (!store.runtime.finalizedRecording) return

  store.runtime.stopInProgress = true
  try {
    await submitFinalizedRecording()
  } finally {
    store.runtime.stopInProgress = false
  }
}

export function recordChunk(blob: Blob): void {
  if (!store.runtime.acceptingChunks) return
  if (blob.size <= 0) return
  store.runtime.chunks.push(blob)
  store.runtime.bytesSoFar += blob.size

  // Capture-health: a chunk arrived, so audio is flowing. Refresh the freshness
  // baseline, clear any pending flush request, and drop a stale-capture warning.
  const now = Date.now()
  store.runtime.lastChunkReceivedAt = now
  store.runtime.flushRequested = false

  // Mirror the chunk + advisory counters to durable storage (write-behind, never
  // awaited). The first persisted chunk is seq=0 — the required init chunk.
  const queue = store.runtime.writeQueue
  if (queue) {
    const seq = store.runtime.nextChunkSeq++
    queue.enqueueChunk(seq, blob)
    queue.enqueueMetadata({
      bytesSoFar: store.runtime.bytesSoFar,
      lastChunkSeq: seq,
      lastChunkReceivedAt: now,
    })
  }

  setSnapshot({
    ...store.snapshot,
    bytesSoFar: store.runtime.bytesSoFar,
    captureHealthWarning: null,
  })

  if (
    !store.runtime.stopInProgress &&
    store.runtime.maxBytes > 0 &&
    shouldAutoStop(store.runtime.bytesSoFar, store.runtime.maxBytes)
  ) {
    void stopAndFinalize()
  }
}

export function handleRecorderFailure(reason: string): void {
  if (shouldIgnoreRecorderFailure(store.snapshot.state)) return

  const activeMs = getElapsedActiveMs(store.snapshot)
  if (meetsEmptyFloor(activeMs, store.runtime.bytesSoFar)) {
    setSalvageMessage(`${reason} Submitting what was recorded.`)
    void stopAndFinalize()
    return
  }

  discard(`${reason} Recording discarded before enough audio was captured.`)
}

/**
 * Flip the live session to unarmed when the write-behind queue downgrades. Scoped
 * to active states so a late write failure from a torn-down queue cannot leak into
 * a fresh idle/terminal snapshot. The next `attachAndStart` re-initializes
 * `durable` from the adapter capability.
 */
function handleDurabilityDowngrade(
  sessionId: string,
  _reason: string | null
): void {
  if (store.runtime.sessionId !== sessionId) return
  if (!isRecordingSessionActive(store.snapshot)) return
  if (!store.snapshot.durable) return
  setSnapshot({ ...store.snapshot, durable: false })
}

const CAPTURE_STALE_MS = 4_000
const CAPTURE_HEALTH_WARNING =
  'We have not received new audio recently. The recording may have stopped capturing.'

function hasLiveAudioTrack(recorder: MediaRecorder): boolean {
  return recorder.stream.getAudioTracks().some((t) => t.readyState === 'live')
}

/**
 * Capture-health watchdog (Phase 3). Driven by the 1s recording interval. While
 * `recording`, if no chunk has arrived within `CAPTURE_STALE_MS`:
 *   1. confirmed loss (recorder inactive / no live track) → existing salvage path;
 *   2. first stale tick → request a manual flush, wait one tick (no warning yet);
 *   3. still stale after the flush → surface a passive warning.
 * Owner-tab only; non-owner presence tabs never run this (Phase 4).
 */
export function checkCaptureHealth(now: number = Date.now()): void {
  if (store.snapshot.state !== 'recording') return
  const controller = store.runtime.controller
  if (!controller) return

  const baseline =
    store.runtime.lastChunkReceivedAt ??
    store.snapshot.lastResumeAt ??
    store.snapshot.startedAt
  if (baseline == null) return
  if (now - baseline < CAPTURE_STALE_MS) return

  // Confirmed audio loss takes priority over a soft warning.
  const recorder = controller.getRecorder()
  if (recorder.state === 'inactive' || !hasLiveAudioTrack(recorder)) {
    handleRecorderFailure('Recording stopped unexpectedly.')
    return
  }

  if (!store.runtime.flushRequested) {
    // First stale tick: ask for a manual flush and give it a tick to land.
    store.runtime.flushRequested = true
    try {
      controller.requestData()
    } catch {
      // Best-effort flush; some browsers throw while a recorder is transitioning.
    }
    return
  }

  // Still stale after the flush request — surface the passive warning (idempotent).
  if (store.snapshot.captureHealthWarning == null) {
    setSnapshot({ ...store.snapshot, captureHealthWarning: CAPTURE_HEALTH_WARNING })
  }
}

// Drive the capture-health watchdog and the presence heartbeat from the 1s
// recording interval tick. Keyed registration keeps dev HMR idempotent when
// this module re-evaluates while the sessionStore module survives.
setTickObserver('capture-health', () => checkCaptureHealth())
setTickObserver('presence-heartbeat', () => heartbeatTick())

export function finalize(): void {
  transition('finalize', { captureHealthWarning: null })
}

export function markUploading(): void {
  transition('markUploading')
}

function setSalvageMessage(message: string | null): void {
  setSnapshot({ ...store.snapshot, salvageMessage: message })
}

function setSubmissionResult(
  result: SessionSnapshot['submissionResult']
): void {
  setSnapshot({ ...store.snapshot, submissionResult: result })
}

export function markSubmitted(): void {
  transition('markSubmitted', { recoverable: null })
}

export function discard(salvageMessage?: string): void {
  transition('discard', { salvageMessage: salvageMessage ?? null })
}

export function markError(message: string): void {
  transition('markError', { errorMessage: message })
}

function markUploadError(message: string): void {
  disposeController(store)
  markError(message)
}

export function markInterrupted(message?: string): void {
  // Capture the queue before the transition detaches it from runtime, so its
  // pending writes can settle before we probe.
  const queue = store.runtime.writeQueue
  transition('markInterrupted', { errorMessage: message ?? null })
  void finalizeInterruptedRecovery(queue)
}

// After an interruption the live recorder is gone but the tab is alive and the
// chunks remain in IDB. Once writes settle, release the lock so the orphan is
// claimable, then probe: if the persisted audio is valid it surfaces as
// recoverable; otherwise it is silently cleaned up and we stay interrupted.
async function finalizeInterruptedRecovery(
  queue: SessionWriteQueue | null
): Promise<void> {
  try {
    if (queue) await queue.whenSettled()
  } catch {
    // ignore — best-effort
  }
  // The live owner is gone: clear presence first, then drop ownership so the
  // orphan is claimable (by this tab's probe or another tab) without remote tabs
  // momentarily seeing a fresh heartbeat for a session that is no longer live.
  clearPresenceQuietly()
  await releaseSessionLockQuietly()
  await releaseOwnerLockQuietly()
  try {
    await runRecoveryProbe()
  } catch {
    // ignore — best-effort
  }
}

export function resetRecordingSession(): void {
  void finalizeTerminalCleanup()
  setSnapshot({ ...IDLE_SNAPSHOT })
}

function hydrateRecoverable(info: RecoverableInfo): void {
  setSnapshot({
    ...IDLE_SNAPSHOT,
    state: 'recoverable',
    title: info.title,
    generatedTitle: info.generatedTitle,
    keyTerms: info.keyTerms,
    codecExtension: info.codecExtension,
    bytesSoFar: info.bytesSoFar,
    recoverable: info,
  })
}

// Recovery may only surface from a non-live state: idle, interrupted, or while
// already showing a recoverable (to chain to the next orphan after save/discard).
function isRecoveryEligibleState(): boolean {
  return (
    store.snapshot.state === 'idle' ||
    store.snapshot.state === 'interrupted' ||
    store.snapshot.state === 'recoverable'
  )
}

/**
 * Probe IDB for a recoverable orphan belonging to the current user and, if found,
 * hydrate the blocking recoverable state. Safe from idle, interrupted, or while
 * already showing a recoverable (to chain to the next orphan after save/discard).
 * Returns true when a recoverable session was surfaced.
 */
export async function runRecoveryProbe(
  excludeSessionId?: string | null
): Promise<boolean> {
  const identity = getIdentity()
  if (!identity.ready || !identity.userId) return false

  if (!isRecoveryEligibleState()) {
    return false
  }

  // Exclude an explicitly-resolved orphan (recovery chaining) so a failed
  // deleteSession can't make this same probe re-surface it in a loop; otherwise
  // exclude the live session, if any.
  const result = await probeRecoverableSessions(
    getPersistence(),
    getSessionLock(),
    identity.userId,
    Date.now(),
    excludeSessionId ?? store.runtime.sessionId
  )
  if (!result) return false

  if (!isRecoveryEligibleState()) {
    // The probe may have taken longer than the provider's startup gate. If the
    // user started/continued live work in the meantime, leave that session alone
    // and release the claimed orphan so it can be recovered on a later idle probe.
    await releaseSessionLockQuietly()
    return false
  }

  hydrateRecoverable(result.info)
  return true
}

// Storage filename for an uploaded recording. Keyed on uploadIntentId so the live
// finalize path and any later recovery save of the SAME recording produce the
// identical name: server dedup recomputes the storage path via
// getMediaPath(userId, projectId, filename), so a divergent name would re-upload
// to a new path on a dedup hit and orphan the originally-uploaded object. The
// timestamp fallback is only reached when no intent id exists, in which case
// create never dedups (no cross-path collision is possible).
function recordingMediaFilename(
  uploadIntentId: string | null,
  codecExtension: string | null
): string {
  const ext = codecExtension ?? 'webm'
  const stable = uploadIntentId ?? `t${Date.now()}`
  return `recording-${stable}.${ext}`
}

// Shared save/discard tail: delete the resolved orphan, release its lock, then
// chain to the next orphan (defensive multi-orphan handling). Returns true when a
// subsequent recoverable was surfaced — callers use that to decide whether to
// apply their own terminal snapshot.
async function clearRecoveredOrphanAndChain(sessionId: string): Promise<boolean> {
  try {
    await getPersistence().deleteSession(sessionId)
  } catch {
    // ignore — best-effort
  }
  await releaseSessionLockQuietly()
  try {
    return await runRecoveryProbe(sessionId)
  } catch {
    return false
  }
}

export interface SaveRecoveredResult {
  ok: boolean
  message?: string
  /**
   * True when the save succeeded and another recovered orphan was immediately
   * surfaced. The caller shows a confirmation toast in this case (the next modal
   * replaces the redirect that a final save performs).
   */
  chainedToNext?: boolean
}

export async function saveRecovered(editedTitle: string): Promise<SaveRecoveredResult> {
  const info = store.snapshot.recoverable
  if (!info) return { ok: false, message: 'No recovered recording to save.' }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      message: "You're offline. Reconnect to save this recording.",
    }
  }

  const persistence = getPersistence()
  let blobs: Blob[]
  try {
    blobs = await persistence.readChunks(info.sessionId)
  } catch {
    return { ok: false, message: 'Could not read the recovered audio.' }
  }
  if (blobs.length === 0) {
    return { ok: false, message: 'The recovered audio is empty.' }
  }

  const normalizedMime = (info.codecMime ?? 'audio/webm').split(';')[0]
  const file = new File(
    blobs,
    recordingMediaFilename(info.uploadIntentId, info.codecExtension),
    { type: normalizedMime }
  )
  const title =
    editedTitle.trim() ||
    info.title ||
    info.generatedTitle ||
    `Recording — ${new Date(info.createdAt).toISOString()}`

  let result: Awaited<ReturnType<typeof runCaptureUpload>>
  try {
    result = await runCaptureUpload(file, title, info.keyTerms, {
      uploadIntentId: info.uploadIntentId ?? undefined,
      allowUpsert: true,
    })
  } catch (err) {
    return {
      ok: false,
      message: (err as Error)?.message ?? 'Could not save the recording.',
    }
  }

  if (result.kind !== 'success') {
    // Leave the IDB row intact so the user can retry safely (server dedup makes
    // a repeated save idempotent).
    return { ok: false, message: result.message ?? 'Could not save the recording.' }
  }

  // Success: clear the orphan and release ownership, then surface the next orphan
  // (defensive multi-orphan handling) or finish as submitted.
  const chainedToNext = await clearRecoveredOrphanAndChain(info.sessionId)
  if (!chainedToNext) {
    setSubmissionResult({ projectId: result.projectId, outcome: result.outcome })
    markSubmitted()
  }
  return { ok: true, chainedToNext }
}

export async function discardRecovered(): Promise<void> {
  const info = store.snapshot.recoverable
  if (!info) return

  if (!(await clearRecoveredOrphanAndChain(info.sessionId))) {
    setSnapshot({ ...IDLE_SNAPSHOT })
  }
}

export function __resetForTesting(): void {
  void releaseOwnerLockQuietly()
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  abortUpload(store)
  disposeController(store)
  store.runtime = createRuntime()
  store.snapshot = { ...IDLE_SNAPSHOT }
  store.listeners.clear()
  lastPresencePublishAt = 0
  // Restore the default (env-detected) adapters so an injected fake from one test
  // cannot leak into the next, and reset identity + presence client id.
  __setPersistenceForTesting(null)
  __setSessionLockForTesting(null)
  __setOwnerLockForTesting(null)
  __setPresenceForTesting(null)
  __setOwnerClientIdForTesting(null)
  __resetIdentityForTesting()
  // Wipe any presence the default adapter left in localStorage, so a stale
  // heartbeat from a prior test can't make the next owner-lock acquire fail.
  clearPresenceQuietly()
}

export function __setSnapshotForTesting(partial: Partial<SessionSnapshot>): void {
  store.snapshot = { ...store.snapshot, ...partial }
  notify()
}
