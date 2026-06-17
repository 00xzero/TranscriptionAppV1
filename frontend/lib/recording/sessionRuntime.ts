import type { Runtime, Store } from './sessionTypes'

export function createRuntime(): Runtime {
  return {
    controller: null,
    chunks: [],
    bytesSoFar: 0,
    acceptingChunks: false,
    stopInProgress: false,
    uploadAbortController: null,
    deviceId: null,
    codecMime: null,
    maxBytes: 0,
    finalizedRecording: null,
    sessionId: null,
    nextChunkSeq: 0,
    writeQueue: null,
    uploadIntentId: null,
  }
}

export function abortUpload(store: Store): void {
  if (store.runtime.uploadAbortController) {
    store.runtime.uploadAbortController.abort()
    store.runtime.uploadAbortController = null
  }
}

export function disposeController(store: Store): void {
  if (store.runtime.controller) {
    store.runtime.controller.dispose()
    store.runtime.controller = null
  }
  store.runtime.chunks = []
  store.runtime.bytesSoFar = 0
  store.runtime.acceptingChunks = false
  store.runtime.stopInProgress = false
}

export function clearFinalizedRecording(store: Store): void {
  store.runtime.finalizedRecording = null
}

export function clearTerminalSessionRuntime(
  store: Store,
  clearSessionActivity: () => void
): Promise<void> {
  clearSessionActivity()
  abortUpload(store)
  const persistenceCleanup = teardownPersistence(store)
  disposeController(store)
  clearFinalizedRecording(store)
  return persistenceCleanup
}

// Queue-owned terminal teardown: stop accepting writes, then delete the IDB
// session + chunks after pending writes settle so a late `dataavailable` cannot
// resurrect rows. Failures are swallowed so cleanup ordering never wedges the
// terminal flow or lock release forever.
function teardownPersistence(store: Store): Promise<void> {
  const queue = store.runtime.writeQueue
  store.runtime.writeQueue = null
  store.runtime.sessionId = null
  store.runtime.nextChunkSeq = 0
  store.runtime.uploadIntentId = null
  if (!queue) return Promise.resolve()
  return queue.closeAndDelete().catch(() => {})
}

export function clearInterruptedSessionRuntime(
  store: Store,
  clearSessionActivity: () => void
): void {
  clearSessionActivity()
  abortUpload(store)
  // Keep the persisted session/chunks for later recovery (Phase 2) and GC; only
  // detach the live queue so a subsequent recording starts a fresh one. Pending
  // writes already in the abandoned queue still drain to completion.
  store.runtime.writeQueue = null
  store.runtime.sessionId = null
  store.runtime.nextChunkSeq = 0
  store.runtime.uploadIntentId = null
  disposeController(store)
  clearFinalizedRecording(store)
}

export function getLiveRecorderFromStore(store: Store): MediaRecorder | null {
  return store.runtime.controller?.getRecorder() ?? null
}

export function stopStreamTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    try {
      track.stop()
    } catch {
      // ignore
    }
  })
}
