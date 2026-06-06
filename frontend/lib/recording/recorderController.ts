export interface RecorderCallbacks {
  onChunk: (blob: Blob) => void
  onError: (reason: string) => void
  onTrackEnded: () => void
  onTrackMutedSustained: () => void
}

export interface RecorderController {
  start(timesliceMs: number): void
  pause(): void
  resume(): void
  requestData(): void
  stop(): Promise<void>
  dispose(): void
  isAttached(): boolean
  getMimeType(): string
  getRecorder(): MediaRecorder
}

interface InternalState {
  recorder: MediaRecorder
  stream: MediaStream
  mime: string
  callbacks: RecorderCallbacks
  trackListeners: Array<() => void>
  stopResolvers: Array<() => void>
  pendingFinalChunkResolvers: Array<() => void>
  pendingManualFlushes: number
  stopDrainFallbackIds: Array<ReturnType<typeof setTimeout>>
  stopWatchdogIds: Array<ReturnType<typeof setTimeout>>
  disposed: boolean
}

const MUTE_DEBOUNCE_MS = 3_000
const STOP_DRAIN_FALLBACK_MS = 250
const STOP_WATCHDOG_MS = 3_000

export function createRecorderController(
  stream: MediaStream,
  mime: string,
  callbacks: RecorderCallbacks
): RecorderController {
  const recorder = new MediaRecorder(stream, { mimeType: mime })
  const state: InternalState = {
    recorder,
    stream,
    mime,
    callbacks,
    trackListeners: [],
    stopResolvers: [],
    pendingFinalChunkResolvers: [],
    pendingManualFlushes: 0,
    stopDrainFallbackIds: [],
    stopWatchdogIds: [],
    disposed: false,
  }

  recorder.addEventListener('dataavailable', (event: BlobEvent) => {
    if (state.disposed) return
    if (event.data && event.data.size > 0) {
      state.callbacks.onChunk(event.data)
    }
    if (state.pendingManualFlushes > 0) {
      state.pendingManualFlushes -= 1
      return
    }
    resolvePendingFinalChunkDrain()
  })

  recorder.addEventListener('error', (event: Event) => {
    if (state.disposed) return
    const err = (event as unknown as { error?: { name?: string; message?: string } }).error
    const reason = err?.message || err?.name || 'Recorder error'
    state.callbacks.onError(reason)
  })

  recorder.addEventListener('stop', () => {
    resolvePendingStop()
    clearStopWatchdogs()
    scheduleFinalChunkDrainFallback()
  })

  const clearStopDrainFallbacks = () => {
    state.stopDrainFallbackIds.forEach((id) => clearTimeout(id))
    state.stopDrainFallbackIds = []
  }

  const clearStopWatchdogs = () => {
    state.stopWatchdogIds.forEach((id) => clearTimeout(id))
    state.stopWatchdogIds = []
  }

  const scheduleFinalChunkDrainFallback = () => {
    if (state.pendingFinalChunkResolvers.length === 0) return

    const fallbackId = setTimeout(() => {
      resolvePendingFinalChunkDrain()
    }, STOP_DRAIN_FALLBACK_MS)
    state.stopDrainFallbackIds.push(fallbackId)
  }

  const resolvePendingStop = () => {
    const resolvers = state.stopResolvers
    state.stopResolvers = []
    resolvers.forEach((resolve) => resolve())
  }

  const resolvePendingFinalChunkDrain = () => {
    const drainResolvers = state.pendingFinalChunkResolvers
    state.pendingFinalChunkResolvers = []
    drainResolvers.forEach((resolve) => resolve())
  }

  const scheduleStopWatchdog = () => {
    const watchdogId = setTimeout(() => {
      resolvePendingStop()
      resolvePendingFinalChunkDrain()
    }, STOP_WATCHDOG_MS)
    state.stopWatchdogIds.push(watchdogId)
  }

  stream.getAudioTracks().forEach((track) => {
    let muteTimeoutId: ReturnType<typeof setTimeout> | null = null
    let sustainedMuteReported = false

    const handleEnded = () => {
      if (state.disposed) return
      state.callbacks.onTrackEnded()
    }
    const clearMuteTimeout = () => {
      if (muteTimeoutId != null) {
        clearTimeout(muteTimeoutId)
        muteTimeoutId = null
      }
    }
    const handleMute = () => {
      if (state.disposed || sustainedMuteReported) return
      clearMuteTimeout()
      muteTimeoutId = setTimeout(() => {
        muteTimeoutId = null
        if (state.disposed || sustainedMuteReported) return
        sustainedMuteReported = true
        state.callbacks.onTrackMutedSustained()
      }, MUTE_DEBOUNCE_MS)
    }
    const handleUnmute = () => {
      clearMuteTimeout()
      sustainedMuteReported = false
    }

    track.addEventListener('ended', handleEnded)
    track.addEventListener('mute', handleMute)
    track.addEventListener('unmute', handleUnmute)
    state.trackListeners.push(() => {
      clearMuteTimeout()
      track.removeEventListener('ended', handleEnded)
      track.removeEventListener('mute', handleMute)
      track.removeEventListener('unmute', handleUnmute)
    })
  })

  return {
    start(timesliceMs: number): void {
      if (state.disposed) return
      if (state.recorder.state === 'inactive') {
        state.recorder.start(timesliceMs)
      }
    },
    pause(): void {
      if (state.disposed) return
      if (state.recorder.state === 'recording') {
        state.recorder.pause()
      }
    },
    resume(): void {
      if (state.disposed) return
      if (state.recorder.state === 'paused') {
        state.recorder.resume()
      }
    },
    requestData(): void {
      if (state.disposed) return
      if (
        state.recorder.state === 'recording' ||
        state.recorder.state === 'paused'
      ) {
        state.pendingManualFlushes += 1
        try {
          state.recorder.requestData()
        } catch (err) {
          state.pendingManualFlushes -= 1
          throw err
        }
      }
    },
    stop(): Promise<void> {
      if (state.disposed) return Promise.resolve()
      return new Promise<void>((resolve) => {
        let dataDrained = false
        const alreadyInactive = state.recorder.state === 'inactive'
        let stopped = alreadyInactive
        const tryResolve = () => {
          if (dataDrained && stopped) {
            resolve()
          }
        }
        if (!alreadyInactive) {
          state.stopResolvers.push(() => {
            stopped = true
            tryResolve()
          })
        }
        state.pendingFinalChunkResolvers.push(() => {
          dataDrained = true
          tryResolve()
        })

        if (alreadyInactive) {
          // State can flip to inactive before the recorder dispatches its final
          // `dataavailable` event, so give that queued chunk the same short
          // drain window as an explicit stop.
          scheduleFinalChunkDrainFallback()
          return
        }

        try {
          state.recorder.stop()
          scheduleStopWatchdog()
        } catch {
          dataDrained = true
          stopped = true
          resolve()
        }
      })
    },
    dispose(): void {
      if (state.disposed) return
      state.disposed = true
      try {
        if (state.recorder.state !== 'inactive') {
          state.recorder.stop()
        }
      } catch {
        // ignore
      }
      state.trackListeners.forEach((cleanup) => cleanup())
      state.trackListeners = []
      clearStopDrainFallbacks()
      clearStopWatchdogs()
      state.stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })
      resolvePendingStop()
      resolvePendingFinalChunkDrain()
      state.pendingManualFlushes = 0
    },
    isAttached(): boolean {
      return !state.disposed
    },
    getMimeType(): string {
      return state.mime
    },
    getRecorder(): MediaRecorder {
      return state.recorder
    },
  }
}
