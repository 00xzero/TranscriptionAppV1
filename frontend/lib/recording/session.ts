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
  startedAt: number | null
  lastResumeAt: number | null
  pausedAccumulatedMs: number
  errorMessage: string | null
}

interface Store {
  snapshot: SessionSnapshot
  listeners: Set<() => void>
  intervalId: number | null
  mockLifecycleTimeoutIds: number[]
}

interface SessionDraft {
  title: string | null
}

const IDLE_SNAPSHOT: SessionSnapshot = Object.freeze({
  state: 'idle',
  title: null,
  startedAt: null,
  lastResumeAt: null,
  pausedAccumulatedMs: 0,
  errorMessage: null,
})

const SERVER_SNAPSHOT: SessionSnapshot = IDLE_SNAPSHOT

const isBrowserDev =
  typeof window !== 'undefined' && process.env.NODE_ENV !== 'production'

const STORE_KEY = Symbol.for('__olivetti_recording_session__')
const DRAFT_STORAGE_KEY = 'recording.sessionDraft'

function createStore(): Store {
  return {
    snapshot: { ...IDLE_SNAPSHOT },
    listeners: new Set(),
    intervalId: null,
    mockLifecycleTimeoutIds: [],
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

// ---- Public actions ----

export interface StartMockMetadata {
  title?: string | null
}

export function startMock(metadata: StartMockMetadata = {}): void {
  clearMockLifecycleTimeouts()
  const now = Date.now()
  const title = metadata.title ?? null
  setSnapshot({
    state: 'recording',
    title,
    startedAt: now,
    lastResumeAt: now,
    pausedAccumulatedMs: 0,
    errorMessage: null,
  })
  writeDraft({ title })
  startIntervalIfNeeded()
}

export function pause(): void {
  const snap = store.snapshot
  if (snap.state !== 'recording') return
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
  setSnapshot({
    ...snap,
    state: 'recording',
    lastResumeAt: Date.now(),
  })
  startIntervalIfNeeded()
}

export function stopMock(): void {
  finalize()
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

export function markSubmitted(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  setSnapshot({ ...store.snapshot, state: 'submitted', lastResumeAt: null })
}

export function discard(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
  clearDraft()
  setSnapshot({ ...store.snapshot, state: 'discarded', lastResumeAt: null })
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
  })
  return true
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
  store.snapshot = { ...IDLE_SNAPSHOT }
  store.listeners.clear()
}

export function __setSnapshotForTesting(partial: Partial<SessionSnapshot>): void {
  store.snapshot = { ...store.snapshot, ...partial }
  notify()
}
