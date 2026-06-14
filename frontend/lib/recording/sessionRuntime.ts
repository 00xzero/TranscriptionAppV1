import { clearDraft } from './sessionDraft'
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
): void {
  clearSessionActivity()
  abortUpload(store)
  clearDraft()
  teardownPersistence(store)
  disposeController(store)
  clearFinalizedRecording(store)
}

// Queue-owned terminal teardown: stop accepting writes, then delete the IDB
// session + chunks after pending writes settle so a late `dataavailable` cannot
// resurrect rows. Fire-and-forget; failures are swallowed.
function teardownPersistence(store: Store): void {
  const queue = store.runtime.writeQueue
  if (queue) {
    void queue.closeAndDelete().catch(() => {})
  }
  store.runtime.writeQueue = null
  store.runtime.sessionId = null
  store.runtime.nextChunkSeq = 0
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
