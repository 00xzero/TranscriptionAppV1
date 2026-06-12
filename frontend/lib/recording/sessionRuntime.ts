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
  disposeController(store)
  clearFinalizedRecording(store)
}

export function clearInterruptedSessionRuntime(
  store: Store,
  clearSessionActivity: () => void
): void {
  clearSessionActivity()
  abortUpload(store)
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
