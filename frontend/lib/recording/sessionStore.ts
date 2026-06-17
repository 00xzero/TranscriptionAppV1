import { createRuntime } from './sessionRuntime'
import {
  IDLE_SNAPSHOT,
  SERVER_SNAPSHOT,
  type SessionSnapshot,
  type Store,
} from './sessionTypes'

const isBrowserDev =
  typeof window !== 'undefined' && process.env.NODE_ENV !== 'production'

const STORE_KEY = Symbol.for('__olivetti_recording_session__')

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

export const store = loadStore()

export function notify(): void {
  store.listeners.forEach((listener) => listener())
}

export function setSnapshot(next: SessionSnapshot): void {
  // `canRetryUpload` is fully derived from runtime state, so compute it here
  // rather than asking every transition to remember to set it.
  store.snapshot = {
    ...next,
    canRetryUpload:
      next.state === 'error' && store.runtime.finalizedRecording != null,
  }
  notify()
}

// Per-tick observer seam. `sessionActions` registers the capture-health watchdog
// here so the 1s recording interval can drive it without sessionStore importing
// sessionActions (which would create a cycle).
let tickObserver: (() => void) | null = null

export function setTickObserver(observer: (() => void) | null): void {
  tickObserver = observer
}

function tickSnapshot(): void {
  // Run the registered watchdog first so any snapshot change it makes is included
  // in this tick's notification.
  if (tickObserver) {
    try {
      tickObserver()
    } catch {
      // A watchdog failure must never stop the timer.
    }
  }
  // Bump the snapshot reference each tick so `useSyncExternalStore` re-renders
  // subscribers reading derived values like `getElapsedActiveMs`.
  store.snapshot = { ...store.snapshot }
  notify()
}

export function startIntervalIfNeeded(): void {
  if (typeof window === 'undefined') return
  if (store.intervalId != null) return
  store.intervalId = window.setInterval(tickSnapshot, 1000)
}

export function clearIntervalIfRunning(): void {
  if (typeof window === 'undefined') return
  if (store.intervalId != null) {
    window.clearInterval(store.intervalId)
    store.intervalId = null
  }
}

export function clearMockLifecycleTimeouts(): void {
  if (typeof window === 'undefined') return
  store.mockLifecycleTimeoutIds.forEach((id) => window.clearTimeout(id))
  store.mockLifecycleTimeoutIds = []
}

export function clearSessionActivity(): void {
  clearIntervalIfRunning()
  clearMockLifecycleTimeouts()
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
