import {
  __resetForTesting,
  attachAndStart,
  discard,
  finalize,
  forceState,
  getElapsedActiveMs,
  getSnapshot,
  hasUnsavedRecording,
  markError,
  markSubmitted,
  markUploading,
  pause,
  recordChunk,
  recoverInterruptedMock,
  resetMock,
  resume,
  startMock,
  subscribe,
} from '@/lib/recording/session'

class FakeMediaRecorder extends EventTarget {
  static shouldThrowOnStart = false
  static lastInstance: FakeMediaRecorder | null = null
  state: RecordingState = 'inactive'

  constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
    super()
    FakeMediaRecorder.lastInstance = this
  }

  start(): void {
    if (FakeMediaRecorder.shouldThrowOnStart) {
      FakeMediaRecorder.shouldThrowOnStart = false
      throw new Error('start failed')
    }
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }

  pause(): void {
    this.state = 'paused'
  }

  resume(): void {
    this.state = 'recording'
  }

  requestData(): void {}
}

function createFakeStream(): MediaStream {
  const track = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    stop: jest.fn(),
  } as unknown as MediaStreamTrack

  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

describe('recording session singleton', () => {
  beforeEach(() => {
    __resetForTesting()
    FakeMediaRecorder.shouldThrowOnStart = false
    FakeMediaRecorder.lastInstance = null
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder,
    })
  })

  test('idle is the default snapshot', () => {
    const snap = getSnapshot()
    expect(snap.state).toBe('idle')
    expect(snap.title).toBeNull()
    expect(snap.startedAt).toBeNull()
    expect(snap.lastResumeAt).toBeNull()
    expect(snap.pausedAccumulatedMs).toBe(0)
  })

  test('startMock transitions idle -> recording with metadata', () => {
    startMock({ title: 'My recording' })
    const snap = getSnapshot()
    expect(snap.state).toBe('recording')
    expect(snap.title).toBe('My recording')
    expect(snap.startedAt).not.toBeNull()
    expect(snap.lastResumeAt).not.toBeNull()
    expect(snap.pausedAccumulatedMs).toBe(0)
  })

  test('pause folds elapsed time into pausedAccumulatedMs', () => {
    const baseTime = 1_000_000
    jest.spyOn(Date, 'now').mockReturnValue(baseTime)
    startMock({ title: 't' })

    jest.spyOn(Date, 'now').mockReturnValue(baseTime + 3000)
    pause()

    const snap = getSnapshot()
    expect(snap.state).toBe('paused')
    expect(snap.pausedAccumulatedMs).toBe(3000)
    expect(snap.lastResumeAt).toBeNull()
  })

  test('resume restarts the clock; elapsed accumulates across runs', () => {
    const t = 2_000_000
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(t)
    startMock()
    now.mockReturnValue(t + 2000)
    pause()
    now.mockReturnValue(t + 5000)
    resume()
    now.mockReturnValue(t + 5500)

    expect(getElapsedActiveMs(getSnapshot(), t + 5500)).toBe(2500)
  })

  test('subscribe / unsubscribe is idempotent under double-add', () => {
    const listener = jest.fn()
    const unsub = subscribe(listener)
    // Calling subscribe with the same function adds it to a Set, so a
    // second add is a no-op.
    const unsub2 = subscribe(listener)

    startMock()
    expect(listener).toHaveBeenCalledTimes(1)

    unsub()
    unsub2()
    listener.mockClear()
    pause()
    expect(listener).not.toHaveBeenCalled()
  })

  test('finalize -> uploading -> submitted is a valid path', () => {
    startMock()
    expect(hasUnsavedRecording()).toBe(true)
    finalize()
    expect(getSnapshot().state).toBe('finalizing')
    expect(hasUnsavedRecording()).toBe(true)
    markUploading()
    expect(getSnapshot().state).toBe('uploading')
    expect(hasUnsavedRecording()).toBe(true)
    markSubmitted()
    expect(getSnapshot().state).toBe('submitted')
    expect(hasUnsavedRecording()).toBe(false)
  })

  test('discard from recording goes to discarded', () => {
    startMock()
    discard()
    expect(getSnapshot().state).toBe('discarded')
  })

  test('markError sets state and message', () => {
    startMock()
    markError('Microphone unplugged')
    const snap = getSnapshot()
    expect(snap.state).toBe('error')
    expect(snap.errorMessage).toBe('Microphone unplugged')
  })

  test('markError preserves elapsed active time from an in-progress segment', () => {
    const baseTime = 3_000_000
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(baseTime)
    startMock()
    now.mockReturnValue(baseTime + 2500)

    markError('Microphone unplugged')

    expect(getSnapshot().pausedAccumulatedMs).toBe(2500)
  })

  test('resetMock clears state to idle', () => {
    startMock({ title: 'x' })
    forceState('interrupted')
    expect(getSnapshot().state).toBe('interrupted')
    resetMock()
    expect(getSnapshot().state).toBe('idle')
    expect(getSnapshot().title).toBeNull()
  })

  test('recoverInterruptedMock restores a persisted draft after reload', () => {
    startMock({ title: 'Recovered title' })
    __resetForTesting()

    window.sessionStorage.setItem(
      'recording.sessionDraft',
      JSON.stringify({ title: 'Recovered title' })
    )

    expect(recoverInterruptedMock()).toBe(true)
    expect(getSnapshot()).toMatchObject({
      state: 'interrupted',
      title: 'Recovered title',
    })
  })

  test('forceState normalizes timing fields per target', () => {
    forceState('recording')
    let snap = getSnapshot()
    expect(snap.state).toBe('recording')
    expect(snap.startedAt).not.toBeNull()
    expect(snap.lastResumeAt).not.toBeNull()

    forceState('paused')
    snap = getSnapshot()
    expect(snap.state).toBe('paused')
    expect(snap.lastResumeAt).toBeNull()

    forceState('finalizing')
    snap = getSnapshot()
    expect(snap.state).toBe('finalizing')
    expect(snap.lastResumeAt).toBeNull()

    forceState('idle')
    snap = getSnapshot()
    expect(snap).toMatchObject({
      state: 'idle',
      startedAt: null,
      lastResumeAt: null,
      pausedAccumulatedMs: 0,
    })
  })

  test('__resetForTesting clears listeners as well as snapshot', () => {
    const listener = jest.fn()
    subscribe(listener)
    __resetForTesting()
    startMock()
    expect(listener).not.toHaveBeenCalled()
  })

  test('failed recorder start does not poison later attach attempts', () => {
    FakeMediaRecorder.shouldThrowOnStart = true

    expect(() =>
      attachAndStart({
        stream: createFakeStream(),
        codec: { mime: 'audio/webm', extension: 'webm' },
        title: null,
        keyTerms: [],
        deviceId: null,
        maxBytes: 1024,
      })
    ).toThrow('start failed')

    expect(getSnapshot().state).toBe('idle')

    expect(() =>
      attachAndStart({
        stream: createFakeStream(),
        codec: { mime: 'audio/webm', extension: 'webm' },
        title: null,
        keyTerms: [],
        deviceId: null,
        maxBytes: 1024,
      })
    ).not.toThrow()
    expect(getSnapshot().state).toBe('recording')
  })

  test('recorder errors stay on the error path even after salvage threshold is met', () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    attachAndStart({
      stream: createFakeStream(),
      codec: { mime: 'audio/webm', extension: 'webm' },
      title: null,
      keyTerms: [],
      deviceId: null,
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    now.mockReturnValue(1_003_000)

    const event = new Event('error')
    Object.defineProperty(event, 'error', {
      value: { message: 'Encoder failure' },
    })
    FakeMediaRecorder.lastInstance?.dispatchEvent(event)

    expect(getSnapshot()).toMatchObject({
      state: 'error',
      errorMessage: 'Encoder failure',
      salvageMessage: null,
    })
  })
})
