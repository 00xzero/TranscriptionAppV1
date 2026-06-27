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

// Per-tick observer seam. `sessionActions` registers tick-driven watchdogs here
// (capture health, presence heartbeat) so the 1s interval can drive them without
// sessionStore importing sessionActions (which would create a cycle). Multiple
// observers are supported; each runs once per tick.
const tickObservers = new Set<() => void>()
const keyedTickObservers = new Map<string, () => void>()

export function addTickObserver(observer: () => void): () => void {
  tickObservers.add(observer)
  return () => {
    tickObservers.delete(observer)
  }
}

export function setTickObserver(key: string, observer: () => void): () => void {
  keyedTickObservers.set(key, observer)
  return () => {
    if (keyedTickObservers.get(key) === observer) {
      keyedTickObservers.delete(key)
    }
  }
}

function tickSnapshot(): void {
  // Run the registered watchdogs first so any snapshot change they make is
  // included in this tick's notification.
  const observers = [...tickObservers, ...keyedTickObservers.values()]
  observers.forEach((observer) => {
    try {
      observer()
    } catch {
      // A watchdog failure must never stop the timer.
    }
  })
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
