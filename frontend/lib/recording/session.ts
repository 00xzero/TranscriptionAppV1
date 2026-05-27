import type { CodecSelection } from './codecs'
import { findCodecByMime, selectCodec } from './codecs'
import {
  createRecorderController,
  type RecorderController,
} from './recorderController'
import { meetsEmptyFloor, shouldAutoStop } from './sizeBudget'
import { PREFERRED_DEVICE_KEY } from './preferredDevice'
import { buildRecordingMicConstraints } from './micConstraints'
import { runCaptureUpload } from '@/lib/hooks/useCapture'

export type RecordingState =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'uploading'
  | 'submitted'
  | 'discarded'
  | 'error'
  | 'interrupted'

export interface SessionSnapshot {
  state: RecordingState
  title: string | null
  generatedTitle: string | null
  startedAt: number | null
  lastResumeAt: number | null
  pausedAccumulatedMs: number
  errorMessage: string | null
  keyTerms: string[]
  codecExtension: 'webm' | 'mp4' | null
  bytesSoFar: number
  salvageMessage: string | null
  submissionResult: {
    projectId: string
    outcome: 'started' | 'saved_needs_retry' | 'saved_status_unknown'
  } | null
}

interface Runtime {
  controller: RecorderController | null
  chunks: Blob[]
  bytesSoFar: number
  stopInProgress: boolean
  deviceId: string | null
  codecMime: string | null
  maxBytes: number
}

interface Store {
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  intervalId: number | null
  mockLifecycleTimeoutIds: number[]
  runtime: Runtime
}

interface SessionDraft {
  title: string | null
  generatedTitle: string | null
  keyTerms: string[]
  codecMime: string | null
  deviceId: string | null
}

const IDLE_SNAPSHOT: SessionSnapshot = Object.freeze({
  state: 'idle',
  title: null,
  generatedTitle: null,
  startedAt: null,
  lastResumeAt: null,
  pausedAccumulatedMs: 0,
  errorMessage: null,
  keyTerms: [],
  codecExtension: null,
  bytesSoFar: 0,
  salvageMessage: null,
  submissionResult: null,
})

const SERVER_SNAPSHOT: SessionSnapshot = IDLE_SNAPSHOT

const isBrowserDev =
  typeof window !== 'undefined' && process.env.NODE_ENV !== 'production'

const STORE_KEY = Symbol.for('__olivetti_recording_session__')
const DRAFT_STORAGE_KEY = 'recording.sessionDraft'

function createRuntime(): Runtime {
  return {
    controller: null,
    chunks: [],
    bytesSoFar: 0,
    stopInProgress: false,
    deviceId: null,
    codecMime: null,
    maxBytes: 0,
  }
}

function createStore(): Store {
  return {
    snapshot: { ...IDLE_SNAPSHOT },
    listeners: new Set(),
    intervalId: null,
    mockLifecycleTimeoutIds: [],
    runtime: createRuntime(),
  }
}

function loadStore(): Store {
  if (isBrowserDev) {
    const g = globalThis as unknown as Record<symbol, Store | undefined>
    if (!g[STORE_KEY]) {
      g[STORE_KEY] = createStore()
    }
    return g[STORE_KEY] as Store
  }
  return createStore()
}

const store = loadStore()

function notify(): void {
  store.listeners.forEach((listener) => listener())
}

function setSnapshot(next: SessionSnapshot): void {
  store.snapshot = next
  notify()
}

function tickSnapshot(): void {
  // Bump the snapshot reference each tick so `useSyncExternalStore` re-renders
  // subscribers reading derived values like `getElapsedActiveMs`.
  store.snapshot = { ...store.snapshot }
  notify()
}

function startIntervalIfNeeded(): void {
  if (typeof window === 'undefined') return
  if (store.intervalId != null) return
  store.intervalId = window.setInterval(tickSnapshot, 1000)
}

function clearIntervalIfRunning(): void {
  if (typeof window === 'undefined') return
  if (store.intervalId != null) {
    window.clearInterval(store.intervalId)
    store.intervalId = null
  }
}

function clearMockLifecycleTimeouts(): void {
  if (typeof window === 'undefined') return
  store.mockLifecycleTimeoutIds.forEach((id) => window.clearTimeout(id))
  store.mockLifecycleTimeoutIds = []
}

function writeDraft(draft: SessionDraft): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

function readDraft(): SessionDraft | null {
  if (typeof window === 'undefined') return null

  const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<SessionDraft>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      generatedTitle:
        typeof parsed.generatedTitle === 'string' ? parsed.generatedTitle : null,
      keyTerms: Array.isArray(parsed.keyTerms)
        ? parsed.keyTerms.filter((t): t is string => typeof t === 'string')
        : [],
      codecMime: typeof parsed.codecMime === 'string' ? parsed.codecMime : null,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : null,
    }
  } catch {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    return null
  }
}

function clearDraft(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
}

function disposeController(): void {
  if (store.runtime.controller) {
    store.runtime.controller.dispose()
    store.runtime.controller = null
  }
  store.runtime.chunks = []
  store.runtime.bytesSoFar = 0
  store.runtime.stopInProgress = false
}

// Defensive reconciliation: if the store survived HMR but lost its interval
// (e.g., after a test reset), restart it so the timer keeps ticking.
if (store.snapshot.state === 'recording') {
  startIntervalIfNeeded()
}

export function getSnapshot(): SessionSnapshot {
  return store.snapshot
}

export function getServerSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT
}

export function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
  }
}

export function getElapsedActiveMs(
  snap: SessionSnapshot,
  now: number = Date.now()
): number {
  if (snap.state === 'recording' && snap.lastResumeAt != null) {
    return snap.pausedAccumulatedMs + (now - snap.lastResumeAt)
  }
  return snap.pausedAccumulatedMs
}

export function hasUnsavedRecording(): boolean {
  const s = store.snapshot.state
  return (
    s === 'recording' ||
    s === 'paused' ||
    s === 'finalizing' ||
    s === 'uploading'
  )
}

// ---- Public actions ----

export interface StartMockMetadata {
  title?: string | null
  keyTerms?: string[]
}

export function startMock(metadata: StartMockMetadata = {}): void {
  clearMockLifecycleTimeouts()
  const now = Date.now()
  const title = metadata.title ?? null
  const keyTerms = metadata.keyTerms ?? []
  setSnapshot({
    ...IDLE_SNAPSHOT,
    state: 'recording',
    title,
    startedAt: now,
    lastResumeAt: now,
    pausedAccumulatedMs: 0,
    errorMessage: null,
    keyTerms,
  })
  writeDraft({
    title,
    generatedTitle: null,
    keyTerms,
    codecMime: null,
    deviceId: null,
  })
  startIntervalIfNeeded()
}

export interface AttachAndStartParams {
  stream: MediaStream
  codec: CodecSelection
  title: string | null
  keyTerms: string[]
  deviceId: string | null
  maxBytes: number
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
    disposeController()
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
  const elapsed = snap.lastResumeAt != null ? now - snap.lastResumeAt : 0
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

export function stopMock(): void {
  finalize()
  scheduleMockLifecycle()
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

  if (controller) {
    try {
      await controller.stop()
    } catch {
      // controller errors will route through onError → handleRecorderFailure
    }
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

  markUploading()

  const result = await runCaptureUpload(
    file,
    persistedTitle,
    store.snapshot.keyTerms
  )

  if (result.kind === 'success') {
    setSubmissionResult({
      projectId: result.projectId,
      outcome: result.outcome,
    })
    markSubmitted()
  } else {
    disposeController()
    markError(result.message)
  }
  store.runtime.stopInProgress = false
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

  disposeController()
  markError(reason)
}

export function finalize(): void {
  const snap = store.snapshot
  if (snap.state !== 'recording' && snap.state !== 'paused') return
  const now = Date.now()
  const additional =
    snap.state === 'recording' && snap.lastResumeAt != null
      ? now - snap.lastResumeAt
      : 0
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
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  disposeController()
  setSnapshot({ ...store.snapshot, state: 'submitted', lastResumeAt: null })
}

export function discard(salvageMessage?: string): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  disposeController()
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
  const additional =
    snap.state === 'recording' && snap.lastResumeAt != null
      ? now - snap.lastResumeAt
      : 0
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  setSnapshot({
    ...snap,
    state: 'error',
    lastResumeAt: null,
    pausedAccumulatedMs: snap.pausedAccumulatedMs + additional,
    errorMessage: message,
  })
}

export function markInterrupted(message?: string): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  setSnapshot({
    ...store.snapshot,
    state: 'interrupted',
    lastResumeAt: null,
    errorMessage: message ?? null,
  })
}

export function resetMock(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  disposeController()
  setSnapshot({ ...IDLE_SNAPSHOT })
}

export function recoverInterruptedMock(): boolean {
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

export interface RestartInterruptedResult {
  ok: boolean
  reason?:
    | 'permission_denied'
    | 'no_codec'
    | 'no_draft'
    | 'no_media_devices'
    | 'attach_failed'
    | 'already_active'
  message?: string
}

// Real interrupted-restart path. Re-requests mic permission, re-selects codec,
// and starts a fresh recording with the preserved metadata — without sending
// the user back through Capture (per spec).
export async function restartInterruptedRecording(
  maxBytes: number
): Promise<RestartInterruptedResult> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: 'no_media_devices',
      message: 'Audio recording is not supported in this environment.',
    }
  }

  const draft = readDraft()
  const snap = store.snapshot
  const preservedTitle = snap.title ?? draft?.title ?? null
  const preservedGeneratedTitle =
    snap.generatedTitle ?? draft?.generatedTitle ?? null
  const preservedKeyTerms =
    snap.keyTerms.length > 0 ? snap.keyTerms : draft?.keyTerms ?? []
  const preservedDeviceId = store.runtime.deviceId ?? draft?.deviceId ?? null
  const preservedCodecMime =
    store.runtime.codecMime ?? draft?.codecMime ?? null

  async function tryAcquire(deviceId: string | null): Promise<MediaStream> {
    const constraints = buildRecordingMicConstraints(deviceId)
    return navigator.mediaDevices.getUserMedia(constraints)
  }

  let stream: MediaStream
  let resolvedDeviceId = preservedDeviceId
  try {
    stream = await tryAcquire(preservedDeviceId)
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (
      preservedDeviceId &&
      (name === 'NotFoundError' || name === 'OverconstrainedError')
    ) {
      // Saved device is gone — clear and retry with the browser default.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(PREFERRED_DEVICE_KEY)
        }
      } catch {
        // ignore
      }
      resolvedDeviceId = null
      try {
        stream = await tryAcquire(null)
      } catch (fallbackErr) {
        const fallbackName = (fallbackErr as { name?: string })?.name
        return fallbackName === 'NotAllowedError' || fallbackName === 'SecurityError'
          ? {
              ok: false,
              reason: 'permission_denied',
              message:
                'Microphone access was denied. Enable mic permission in your browser to continue.',
            }
          : {
              ok: false,
              reason: 'no_media_devices',
              message: 'No microphone was found.',
            }
      }
    } else if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        ok: false,
        reason: 'permission_denied',
        message:
          'Microphone access was denied. Enable mic permission in your browser to continue.',
      }
    } else {
      return {
        ok: false,
        reason: 'no_media_devices',
        message: 'No microphone was found.',
      }
    }
  }

  const codec = findCodecByMime(preservedCodecMime) ?? selectCodec()
  if (!codec) {
    stream.getTracks().forEach((t) => t.stop())
    return {
      ok: false,
      reason: 'no_codec',
      message: "Audio recording isn't supported in this browser.",
    }
  }

  try {
    attachAndStart({
      stream,
      codec,
      title: preservedTitle,
      keyTerms: preservedKeyTerms,
      deviceId: resolvedDeviceId,
      maxBytes,
    })
    if (preservedGeneratedTitle) {
      setSnapshot({ ...store.snapshot, generatedTitle: preservedGeneratedTitle })
      writeDraft({
        title: preservedTitle,
        generatedTitle: preservedGeneratedTitle,
        keyTerms: preservedKeyTerms,
        codecMime: codec.mime,
        deviceId: resolvedDeviceId,
      })
    }
  } catch (err) {
    // Clean up the freshly acquired stream — it has no owner if attach throws.
    stream.getTracks().forEach((t) => {
      try { t.stop() } catch { /* ignore */ }
    })
    if (err instanceof RecordingAlreadyActiveError) {
      return {
        ok: false,
        reason: 'already_active',
        message: err.message,
      }
    }
    return {
      ok: false,
      reason: 'attach_failed',
      message:
        (err as Error)?.message ??
        'Could not start the recorder. Try again.',
    }
  }

  return { ok: true }
}

// `forceState` normalizes timing fields per target state so that dev controls
// and tests cannot produce impossible snapshots.
export function forceState(target: RecordingState): void {
  const snap = store.snapshot
  const now = Date.now()

  switch (target) {
    case 'idle': {
      clearIntervalIfRunning()
      clearMockLifecycleTimeouts()
      setSnapshot({ ...IDLE_SNAPSHOT })
      return
    }
    case 'recording': {
      clearMockLifecycleTimeouts()
      const startedAt = snap.startedAt ?? now
      setSnapshot({
        ...snap,
        state: 'recording',
        startedAt,
        lastResumeAt: now,
        errorMessage: null,
      })
      startIntervalIfNeeded()
      return
    }
    case 'paused': {
      const fold =
        snap.state === 'recording' && snap.lastResumeAt != null
          ? now - snap.lastResumeAt
          : 0
      const startedAt = snap.startedAt ?? now
      clearIntervalIfRunning()
      setSnapshot({
        ...snap,
        state: 'paused',
        startedAt,
        lastResumeAt: null,
        pausedAccumulatedMs: snap.pausedAccumulatedMs + fold,
      })
      return
    }
    case 'finalizing':
    case 'uploading': {
      const fold =
        snap.state === 'recording' && snap.lastResumeAt != null
          ? now - snap.lastResumeAt
          : 0
      clearIntervalIfRunning()
      setSnapshot({
        ...snap,
        state: target,
        lastResumeAt: null,
        pausedAccumulatedMs: snap.pausedAccumulatedMs + fold,
      })
      return
    }
    case 'submitted':
    case 'discarded':
    case 'error':
    case 'interrupted': {
      clearIntervalIfRunning()
      clearMockLifecycleTimeouts()
      setSnapshot({
        ...snap,
        state: target,
        lastResumeAt: null,
      })
      return
    }
  }
}

// ---- Test-only helpers ----

export function __resetForTesting(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  disposeController()
  store.runtime = createRuntime()
  store.snapshot = { ...IDLE_SNAPSHOT }
  store.listeners.clear()
}

export function __setSnapshotForTesting(partial: Partial<SessionSnapshot>): void {
  store.snapshot = { ...store.snapshot, ...partial }
  notify()
}
