// Shared test double for the browser `MediaRecorder`, used by the recorder
// controller, the session singleton, and the recording-page tests. It replaces
// the per-file inline fakes that previously drifted apart.
//
// Behavior is configurable via statics so both call sites are satisfied:
//   - `autoDispatchStop`: when true, `stop()` synchronously dispatches a `stop`
//     event (the session tests drive finalize this way). When false (default),
//     tests dispatch `stop`/`dataavailable` manually to control ordering (the
//     recorder-controller drain tests need this).
//   - `shouldThrowOnStart`: makes the next `start()` throw once, to exercise the
//     "recorder failed to start" path.

type FakeRecorderState = 'inactive' | 'recording' | 'paused'

export class FakeMediaRecorder extends EventTarget {
  static lastInstance: FakeMediaRecorder | null = null
  static shouldThrowOnStart = false
  static autoDispatchStop = false
  static isTypeSupported: (type: string) => boolean = () => true

  state: FakeRecorderState = 'inactive'
  readonly stream: MediaStream
  readonly mimeType: string

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.stream = stream
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder.lastInstance = this
  }

  start(_timesliceMs?: number): void {
    if (FakeMediaRecorder.shouldThrowOnStart) {
      FakeMediaRecorder.shouldThrowOnStart = false
      throw new Error('start failed')
    }
    this.state = 'recording'
  }

  pause(): void {
    this.state = 'paused'
  }

  resume(): void {
    this.state = 'recording'
  }

  requestData(): void {}

  stop(): void {
    this.state = 'inactive'
    if (FakeMediaRecorder.autoDispatchStop) {
      this.dispatchEvent(new Event('stop'))
    }
  }
}

/** A `MediaStreamTrack` whose events can be dispatched in tests. */
export interface FakeMediaStreamTrack extends EventTarget {
  stop: jest.Mock
  readyState: MediaStreamTrackState
}

/**
 * A fake `MediaStream` whose single audio track is a real `EventTarget`, so
 * tests can dispatch `ended` / `mute` / `unmute` to drive the salvage policy.
 */
export function createFakeStream(): MediaStream {
  const track = Object.assign(new EventTarget(), {
    stop: jest.fn(),
    // Live by default; capture-health tests flip this to 'ended' to simulate a
    // track that died while the recorder still reports `recording`.
    readyState: 'live' as MediaStreamTrackState,
  }) as FakeMediaStreamTrack

  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

/** Returns the first audio track of a fake stream as a dispatchable target. */
export function getFakeTrack(stream: MediaStream): FakeMediaStreamTrack {
  return stream.getAudioTracks()[0] as unknown as FakeMediaStreamTrack
}

export function dispatchChunk(target: EventTarget, bytes: number): void {
  const event = new Event('dataavailable')
  Object.defineProperty(event, 'data', {
    value: new Blob([new Uint8Array(bytes)]),
  })
  target.dispatchEvent(event)
}

export function dispatchStop(target: EventTarget): void {
  target.dispatchEvent(new Event('stop'))
}

export function dispatchRecorderError(target: EventTarget, message: string): void {
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: { message } })
  target.dispatchEvent(event)
}

/**
 * Define the fake on both `window` and `globalThis` (bare `MediaRecorder`
 * references in app code resolve against whichever the runtime exposes) and
 * reset the configurable statics. Call in `beforeEach`.
 */
export function installMediaRecorderMock(): typeof FakeMediaRecorder {
  resetMediaRecorderMock()
  const g = globalThis as unknown as { MediaRecorder?: unknown }
  g.MediaRecorder = FakeMediaRecorder
  if (typeof window !== 'undefined') {
    ;(window as unknown as { MediaRecorder?: unknown }).MediaRecorder =
      FakeMediaRecorder
  }
  return FakeMediaRecorder
}

export function resetMediaRecorderMock(): void {
  FakeMediaRecorder.lastInstance = null
  FakeMediaRecorder.shouldThrowOnStart = false
  FakeMediaRecorder.autoDispatchStop = false
  FakeMediaRecorder.isTypeSupported = () => true
}
