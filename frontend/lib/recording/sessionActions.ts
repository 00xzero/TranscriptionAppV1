import {
  createRecorderController,
} from './recorderController'
import {
  abortUpload,
  clearFinalizedRecording,
  createRuntime,
  disposeController,
} from './sessionRuntime'
import {
  clearIntervalIfRunning,
  clearMockLifecycleTimeouts,
  notify,
  setSnapshot,
  setTickObserver,
  startIntervalIfNeeded,
  store,
} from './sessionStore'
import {
  IDLE_SNAPSHOT,
  type AttachAndStartParams,
  type SessionSnapshot,
} from './sessionTypes'
import { shouldIgnoreRecorderFailure } from './sessionTransitions'
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
  __setPresenceForTesting,
  __setOwnerClientIdForTesting,
} from './presence'
import {
  clearPresenceQuietly,
  publishPresence,
  __resetPresenceThrottle,
} from './sessionPresence'
import {
  discard,
  finalize,
  getElapsedActiveMs,
  hasUnsavedRecording,
  isRecordingSessionActive,
  releaseOwnerLockQuietly,
} from './sessionCore'
import {
  recordingMediaFilename,
  submitFinalizedRecording,
} from './sessionUpload'
import {
  markInterrupted,
  runRecoveryProbe,
} from './sessionRecovery'
import { getIdentity, __resetIdentityForTesting } from './sessionIdentity'
import { meetsEmptyFloor, shouldAutoStop } from './sizeBudget'
import { randomId } from '@/lib/ids'

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

// Drive the capture-health watchdog from the 1s recording interval tick. Keyed
// registration keeps dev HMR idempotent when this module re-evaluates while the
// sessionStore module survives. (The presence-heartbeat tick is registered in
// sessionPresence.)
setTickObserver('capture-health', () => checkCaptureHealth())

function setSalvageMessage(message: string | null): void {
  setSnapshot({ ...store.snapshot, salvageMessage: message })
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
  __resetPresenceThrottle()
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
