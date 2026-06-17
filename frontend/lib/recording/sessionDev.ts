import {
  getActiveSegmentMs,
} from './sessionActions'
import {
  clearInterruptedSessionRuntime,
  clearTerminalSessionRuntime,
  disposeController,
} from './sessionRuntime'
import {
  clearIntervalIfRunning,
  clearMockLifecycleTimeouts,
  clearSessionActivity,
  setSnapshot,
  startIntervalIfNeeded,
  store,
} from './sessionStore'
import {
  IDLE_SNAPSHOT,
  type RecordingState,
  type StartMockMetadata,
} from './sessionTypes'

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
  startIntervalIfNeeded()
}

// `forceState` normalizes timing fields per target state so that dev controls
// and tests cannot produce impossible snapshots.
export function forceState(target: RecordingState): void {
  const snap = store.snapshot
  const now = Date.now()

  switch (target) {
    case 'idle': {
      void clearTerminalSessionRuntime(store, clearSessionActivity)
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
      const fold = getActiveSegmentMs(snap, now)
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
      const fold = getActiveSegmentMs(snap, now)
      const startedAt = snap.startedAt ?? now
      clearIntervalIfRunning()
      setSnapshot({
        ...snap,
        state: target,
        startedAt,
        lastResumeAt: null,
        pausedAccumulatedMs: snap.pausedAccumulatedMs + fold,
      })
      return
    }
    case 'submitted':
    case 'discarded': {
      void clearTerminalSessionRuntime(store, clearSessionActivity)
      setSnapshot({
        ...snap,
        state: target,
        lastResumeAt: null,
      })
      return
    }
    case 'interrupted': {
      clearInterruptedSessionRuntime(store, clearSessionActivity)
      setSnapshot({
        ...snap,
        state: target,
        lastResumeAt: null,
      })
      return
    }
    case 'recoverable': {
      // Dev-only: preview the recovery modal with a mock orphan payload.
      clearInterruptedSessionRuntime(store, clearSessionActivity)
      setSnapshot({
        ...IDLE_SNAPSHOT,
        state: 'recoverable',
        title: snap.title ?? null,
        generatedTitle: snap.generatedTitle ?? null,
        keyTerms: snap.keyTerms,
        codecExtension: 'webm',
        bytesSoFar: 1_000_000,
        recoverable: {
          sessionId: 'mock-recoverable-session',
          uploadIntentId: null,
          title: snap.title ?? null,
          generatedTitle: snap.generatedTitle ?? null,
          keyTerms: snap.keyTerms,
          codecMime: 'audio/webm',
          codecExtension: 'webm',
          bytesSoFar: 1_000_000,
          createdAt: now,
          remainingCount: 0,
        },
      })
      return
    }
    case 'error': {
      clearIntervalIfRunning()
      clearMockLifecycleTimeouts()
      disposeController(store)
      setSnapshot({
        ...snap,
        state: target,
        lastResumeAt: null,
      })
      return
    }
  }
}
