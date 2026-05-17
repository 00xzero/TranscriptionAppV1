export interface RecorderCallbacks {
  onChunk: (blob: Blob) => void
  onError: (reason: string) => void
  onTrackEnded: () => void
}

export interface RecorderController {
  start(timesliceMs: number): void
  pause(): void
  resume(): void
  stop(): Promise<void>
  dispose(): void
  isAttached(): boolean
  getMimeType(): string
}

interface InternalState {
  recorder: MediaRecorder
  stream: MediaStream
  mime: string
  callbacks: RecorderCallbacks
  trackListeners: Array<() => void>
  stopResolvers: Array<() => void>
  disposed: boolean
}

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
    disposed: false,
  }

  recorder.addEventListener('dataavailable', (event: BlobEvent) => {
    if (state.disposed) return
    if (event.data && event.data.size > 0) {
      state.callbacks.onChunk(event.data)
    }
  })

  recorder.addEventListener('error', (event: Event) => {
    if (state.disposed) return
    const err = (event as unknown as { error?: { name?: string; message?: string } }).error
    const reason = err?.message || err?.name || 'Recorder error'
    state.callbacks.onError(reason)
  })

  recorder.addEventListener('stop', () => {
    const resolvers = state.stopResolvers
    state.stopResolvers = []
    resolvers.forEach((resolve) => resolve())
  })

  stream.getAudioTracks().forEach((track) => {
    const handleEnded = () => {
      if (state.disposed) return
      state.callbacks.onTrackEnded()
    }
    track.addEventListener('ended', handleEnded)
    state.trackListeners.push(() => track.removeEventListener('ended', handleEnded))
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
    stop(): Promise<void> {
      if (state.disposed) return Promise.resolve()
      if (state.recorder.state === 'inactive') return Promise.resolve()
      return new Promise<void>((resolve) => {
        state.stopResolvers.push(resolve)
        try {
          state.recorder.stop()
        } catch {
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
      state.stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // ignore
        }
      })
      const resolvers = state.stopResolvers
      state.stopResolvers = []
      resolvers.forEach((resolve) => resolve())
    },
    isAttached(): boolean {
      return !state.disposed
    },
    getMimeType(): string {
      return state.mime
    },
  }
}
