import {
  createRecorderController,
} from './recorderController'
import { clearDraft, readDraft, writeDraft } from './sessionDraft'
import {
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
  startIntervalIfNeeded,
  store,
} from './sessionStore'
import {
  IDLE_SNAPSHOT,
  type AttachAndStartParams,
  type RecordingState,
  type SessionSnapshot,
} from './sessionTypes'
import { meetsEmptyFloor, shouldAutoStop } from './sizeBudget'
import { runCaptureUpload } from '@/lib/hooks/useCapture'

let captureUploader = runCaptureUpload

export function getLiveRecorder(): MediaRecorder | null {
  return getLiveRecorderFromStore(store)
}

export function getElapsedActiveMs(
  snap: SessionSnapshot,
  now: number = Date.now()
): number {
  return snap.pausedAccumulatedMs + getActiveSegmentMs(snap, now)
}

export function getActiveSegmentMs(
  snap: SessionSnapshot,
  now: number = Date.now()
): number {
  return snap.state === 'recording' && snap.lastResumeAt != null
    ? now - snap.lastResumeAt
    : 0
}

// A capture is "in flight" — recording, finishing, uploading, or finished but
// holding a recording that can still be retried. Used both to guard against
// starting a second capture and to warn before navigating away.
export function isRecordingSessionActive(snapshot: SessionSnapshot): boolean {
  const s = snapshot.state
  return (
    s === 'recording' ||
    s === 'paused' ||
    s === 'finalizing' ||
    s === 'uploading' ||
    (s === 'error' && snapshot.canRetryUpload)
  )
}

export function hasUnsavedRecording(): boolean {
  return isRecordingSessionActive(store.snapshot)
}

export class RecordingAlreadyActiveError extends Error {
  readonly code = 'recording_already_active' as const
  constructor() {
    super('A recording is already in progress. Return to it before starting another.')
    this.name = 'RecordingAlreadyActiveError'
  }
}

export function attachAndStart(params: AttachAndStartParams): void {
  // Only one live session is supported. Refuse explicitly so callers can stop
  // the orphaned stream and surface a clear message — silently returning would
  // leak the newly acquired stream and pretend a new recording started.
  if (
    (store.runtime.controller && store.runtime.controller.isAttached()) ||
    hasUnsavedRecording()
  ) {
    throw new RecordingAlreadyActiveError()
  }

  clearMockLifecycleTimeouts()
  clearFinalizedRecording(store)

  const controller = createRecorderController(params.stream, params.codec.mime, {
    onChunk: (blob) => recordChunk(blob),
    onError: (reason) => handleRecorderError(reason),
    onTrackEnded: () => handleRecorderFailure('Microphone disconnected.'),
    onTrackMutedSustained: () =>
      handleRecorderFailure('Microphone went quiet for too long.'),
  })

  store.runtime.controller = controller
  store.runtime.chunks = []
  store.runtime.bytesSoFar = 0
  store.runtime.stopInProgress = false
  store.runtime.deviceId = params.deviceId
  store.runtime.codecMime = params.codec.mime
  store.runtime.maxBytes = params.maxBytes

  try {
    controller.start(1000)
  } catch (err) {
    // Recorder startup is the last synchronous failure point. If it throws,
    // leave the singleton as idle as it was before this attempt so a later
    // attach can proceed normally.
    disposeController(store)
    store.runtime.deviceId = null
    store.runtime.codecMime = null
    store.runtime.maxBytes = 0
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
  })
  writeDraft({
    title: params.title,
    generatedTitle,
    keyTerms: params.keyTerms,
    codecMime: params.codec.mime,
    deviceId: params.deviceId,
  })
  startIntervalIfNeeded()
}

export function pause(): void {
  const snap = store.snapshot
  if (snap.state !== 'recording') return

  if (store.runtime.controller) {
    store.runtime.controller.pause()
  }

  const now = Date.now()
  const elapsed = getActiveSegmentMs(snap, now)
  clearIntervalIfRunning()
  setSnapshot({
    ...snap,
    state: 'paused',
    lastResumeAt: null,
    pausedAccumulatedMs: snap.pausedAccumulatedMs + elapsed,
  })
}

export function resume(): void {
  const snap = store.snapshot
  if (snap.state !== 'paused') return

  if (store.runtime.controller) {
    store.runtime.controller.resume()
  }

  setSnapshot({
    ...snap,
    state: 'recording',
    lastResumeAt: Date.now(),
  })
  startIntervalIfNeeded()
}

function scheduleMockLifecycle(): void {
  if (typeof window === 'undefined') return

  clearMockLifecycleTimeouts()
  store.mockLifecycleTimeoutIds.push(
    window.setTimeout(() => {
      if (store.snapshot.state === 'finalizing') {
        markUploading()
      }
    }, 800),
    window.setTimeout(() => {
      if (store.snapshot.state === 'uploading') {
        markSubmitted()
      }
    }, 1800)
  )
}

// Single-flight, drain-aware Stop. Used by the recording page's controls and
// by the size-budget auto-stop.
export async function stopAndFinalize(): Promise<void> {
  if (store.runtime.stopInProgress) return
  store.runtime.stopInProgress = true

  const controller = store.runtime.controller
  finalize()
  if (!controller) {
    scheduleMockLifecycle()
    store.runtime.stopInProgress = false
    return
  }

  try {
    await controller.stop()
  } catch {
    // controller errors will route through onError → handleRecorderFailure
  }

  if (typeof window === 'undefined') {
    store.runtime.stopInProgress = false
    return
  }

  const normalizedMime = (store.runtime.codecMime ?? 'audio/webm').split(';')[0]
  const blob = new Blob(store.runtime.chunks, { type: normalizedMime })
  const ext = store.snapshot.codecExtension ?? 'webm'
  const isoStamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `recording-${isoStamp}.${ext}`
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

  markUploading()

  const result = await captureUploader(
    finalized.file,
    finalized.title,
    finalized.keyTerms
  )

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
  if (blob.size <= 0) return
  store.runtime.chunks.push(blob)
  store.runtime.bytesSoFar += blob.size

  setSnapshot({
    ...store.snapshot,
    bytesSoFar: store.runtime.bytesSoFar,
  })

  if (
    !store.runtime.stopInProgress &&
    store.runtime.maxBytes > 0 &&
    shouldAutoStop(store.runtime.bytesSoFar, store.runtime.maxBytes)
  ) {
    void stopAndFinalize()
  }
}

const TERMINAL_OR_FINALIZING_STATES: ReadonlySet<RecordingState> = new Set([
  'finalizing',
  'uploading',
  'submitted',
  'discarded',
])

export function handleRecorderFailure(reason: string): void {
  if (TERMINAL_OR_FINALIZING_STATES.has(store.snapshot.state)) return

  const activeMs = getElapsedActiveMs(store.snapshot)
  if (meetsEmptyFloor(activeMs, store.runtime.bytesSoFar)) {
    setSalvageMessage(`${reason} Submitting what was recorded.`)
    void stopAndFinalize()
    return
  }

  discard(`${reason} Recording discarded before enough audio was captured.`)
}

function handleRecorderError(reason: string): void {
  if (TERMINAL_OR_FINALIZING_STATES.has(store.snapshot.state)) return

  disposeController(store)
  markError(reason)
}

export function finalize(): void {
  const snap = store.snapshot
  if (snap.state !== 'recording' && snap.state !== 'paused') return
  const now = Date.now()
  const additional = getActiveSegmentMs(snap, now)
  clearIntervalIfRunning()
  setSnapshot({
    ...snap,
    state: 'finalizing',
    lastResumeAt: null,
    pausedAccumulatedMs: snap.pausedAccumulatedMs + additional,
  })
}

export function markUploading(): void {
  setSnapshot({ ...store.snapshot, state: 'uploading' })
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
  clearTerminalSessionRuntime(store, clearSessionActivity)
  setSnapshot({
    ...store.snapshot,
    state: 'submitted',
    lastResumeAt: null,
  })
}

export function discard(salvageMessage?: string): void {
  clearTerminalSessionRuntime(store, clearSessionActivity)
  setSnapshot({
    ...store.snapshot,
    state: 'discarded',
    lastResumeAt: null,
    salvageMessage: salvageMessage ?? null,
  })
}

export function markError(message: string): void {
  const snap = store.snapshot
  const now = Date.now()
  const additional = getActiveSegmentMs(snap, now)
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  disposeController(store)
  setSnapshot({
    ...snap,
    state: 'error',
    lastResumeAt: null,
    pausedAccumulatedMs: snap.pausedAccumulatedMs + additional,
    errorMessage: message,
  })
}

function markUploadError(message: string): void {
  disposeController(store)
  markError(message)
}

export function markInterrupted(message?: string): void {
  clearInterruptedSessionRuntime(store, clearSessionActivity)
  setSnapshot({
    ...store.snapshot,
    state: 'interrupted',
    lastResumeAt: null,
    errorMessage: message ?? null,
  })
}

export function resetRecordingSession(): void {
  clearTerminalSessionRuntime(store, clearSessionActivity)
  setSnapshot({ ...IDLE_SNAPSHOT })
}

export function recoverInterruptedDraft(): boolean {
  if (store.snapshot.state !== 'idle') return false

  const draft = readDraft()
  if (!draft) return false

  setSnapshot({
    ...IDLE_SNAPSHOT,
    state: 'interrupted',
    title: draft.title,
    generatedTitle: draft.generatedTitle,
    keyTerms: draft.keyTerms,
  })
  return true
}

export function __resetForTesting(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  disposeController(store)
  store.runtime = createRuntime()
  store.snapshot = { ...IDLE_SNAPSHOT }
  store.listeners.clear()
}

export function __setSnapshotForTesting(partial: Partial<SessionSnapshot>): void {
  store.snapshot = { ...store.snapshot, ...partial }
  notify()
}

export function __setCaptureUploaderForTesting(
  uploader: typeof runCaptureUpload
): void {
  captureUploader = uploader
}

export function __resetCaptureUploaderForTesting(): void {
  captureUploader = runCaptureUpload
}
