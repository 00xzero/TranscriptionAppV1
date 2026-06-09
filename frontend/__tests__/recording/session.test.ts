import {
  __resetCaptureUploaderForTesting,
  __resetForTesting,
  __setCaptureUploaderForTesting,
  attachAndStart,
  discard,
  finalize,
  forceState,
  getElapsedActiveMs,
  getLiveRecorder,
  getSnapshot,
  hasUnsavedRecording,
  markError,
  markInterrupted,
  markSubmitted,
  markUploading,
  pause,
  recordChunk,
  recoverInterruptedDraft,
  resetRecordingSession,
  retryFinalizedUpload,
  resume,
  stopAndFinalize,
  startMock,
  subscribe,
  type AttachAndStartParams,
} from '@/lib/recording/session'
import {
  FakeMediaRecorder,
  createFakeStream,
  dispatchChunk,
  dispatchRecorderError,
  installMediaRecorderMock,
} from '../../__mocks__/MediaRecorder'

const mockRunCaptureUpload = jest.fn()
const DEFAULT_CODEC = { mime: 'audio/webm', extension: 'webm' } as const

function attachRecording(overrides: Partial<AttachAndStartParams> = {}): void {
  attachAndStart({
    stream: createFakeStream(),
    codec: DEFAULT_CODEC,
    title: null,
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024,
    ...overrides,
  })
}

function lastRecorder(): FakeMediaRecorder {
  if (!FakeMediaRecorder.lastInstance) {
    throw new Error('Expected a MediaRecorder instance to exist')
  }
  return FakeMediaRecorder.lastInstance as FakeMediaRecorder
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function dispatchStopDrain(recorder: FakeMediaRecorder, manualBytes: number): void {
  dispatchChunk(recorder, manualBytes)
  dispatchChunk(recorder, 0)
}

function advanceClockPastEmptyFloor(): void {
  const startedAt = getSnapshot().startedAt ?? 1_000_000
  jest.spyOn(Date, 'now').mockReturnValue(startedAt + 3_000)
}

describe('recording session singleton', () => {
  beforeEach(() => {
    __resetForTesting()
    __setCaptureUploaderForTesting(mockRunCaptureUpload)
    mockRunCaptureUpload.mockReset()
    installMediaRecorderMock()
    // The session finalize path relies on `stop()` emitting a `stop` event.
    FakeMediaRecorder.autoDispatchStop = true
  })

  afterEach(() => {
    __resetCaptureUploaderForTesting()
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

  test('stop without an attached controller marks the session interrupted', async () => {
    startMock({ title: 'Missing controller' })

    await stopAndFinalize()

    expect(getSnapshot()).toMatchObject({
      state: 'interrupted',
      title: 'Missing controller',
      errorMessage: 'Recording session was lost before it could be saved.',
    })
    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
    expect(hasUnsavedRecording()).toBe(false)
  })

  test('discard during stop finalization cancels the pending upload', async () => {
    FakeMediaRecorder.autoDispatchStop = false
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })

    attachRecording({
      title: 'Discard while stopping',
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))

    const stopPromise = stopAndFinalize()
    expect(getSnapshot().state).toBe('finalizing')

    discard()
    await stopPromise

    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
    expect(getSnapshot().state).toBe('discarded')
    expect(getLiveRecorder()).toBeNull()
    expect(hasUnsavedRecording()).toBe(false)
  })

  test('stop requests a final recorder data flush before finalizing', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })

    attachRecording({
      title: 'Flush before stop',
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    const recorder = lastRecorder()
    const requestDataSpy = jest.spyOn(recorder, 'requestData')

    const stopPromise = stopAndFinalize()

    expect(requestDataSpy).toHaveBeenCalledTimes(1)

    dispatchStopDrain(recorder, 512)
    await stopPromise

    expect(mockRunCaptureUpload.mock.calls[0][0]).toBeInstanceOf(File)
    expect(mockRunCaptureUpload.mock.calls[0][0].size).toBe(4608)
  })

  test('stop below the empty floor discards without uploading', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(4_000_000)
    attachRecording({
      title: 'Too short',
      maxBytes: 1024 * 1024,
    })
    now.mockReturnValue(4_000_500)

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 0)
    await stopPromise

    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
    expect(getSnapshot()).toMatchObject({
      state: 'discarded',
      salvageMessage: 'Recording discarded before enough audio was captured.',
    })
    expect(hasUnsavedRecording()).toBe(false)
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

  test('resetRecordingSession clears state to idle', () => {
    startMock({ title: 'x' })
    forceState('interrupted')
    expect(getSnapshot().state).toBe('interrupted')
    resetRecordingSession()
    expect(getSnapshot().state).toBe('idle')
    expect(getSnapshot().title).toBeNull()
  })

  test('recoverInterruptedDraft restores a persisted real draft after reload', () => {
    window.sessionStorage.setItem(
      'recording.sessionDraft',
      JSON.stringify({ title: 'Recovered title' })
    )

    expect(recoverInterruptedDraft()).toBe(true)
    expect(getSnapshot()).toMatchObject({
      state: 'interrupted',
      title: 'Recovered title',
    })
  })

  test('startMock does not write a real interrupted recovery draft', () => {
    startMock({ title: 'Mock-only title' })

    expect(window.sessionStorage.getItem('recording.sessionDraft')).toBeNull()
  })

  test('corrupt interrupted drafts are cleared without recovering', () => {
    window.sessionStorage.setItem('recording.sessionDraft', '{not-json')

    expect(recoverInterruptedDraft()).toBe(false)
    expect(window.sessionStorage.getItem('recording.sessionDraft')).toBeNull()
    expect(getSnapshot().state).toBe('idle')
  })

  test('attachAndStart writes a real interrupted recovery draft', () => {
    attachRecording({
      title: 'Real draft title',
      keyTerms: ['alpha'],
      deviceId: 'mic-1',
    })

    expect(window.sessionStorage.getItem('recording.sessionDraft')).toEqual(
      JSON.stringify({
        title: 'Real draft title',
        generatedTitle: null,
        keyTerms: ['alpha'],
        codecMime: 'audio/webm',
        deviceId: 'mic-1',
      })
    )
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

  test('getLiveRecorder exposes the attached recorder, null otherwise', () => {
    expect(getLiveRecorder()).toBeNull()

    attachRecording()
    expect(getLiveRecorder()).toBe(FakeMediaRecorder.lastInstance)

    markSubmitted() // disposes the controller
    expect(getLiveRecorder()).toBeNull()
  })

  test('markInterrupted disposes an attached recorder while preserving interrupted state', () => {
    attachRecording()
    expect(getLiveRecorder()).toBe(FakeMediaRecorder.lastInstance)

    markInterrupted('Page reloaded.')

    expect(getSnapshot()).toMatchObject({
      state: 'interrupted',
      errorMessage: 'Page reloaded.',
    })
    expect(getLiveRecorder()).toBeNull()
  })

  test.each(['idle', 'submitted', 'discarded', 'error', 'interrupted'] as const)(
    'forceState(%s) does not leave a live recorder attached',
    (state) => {
      attachRecording()
      expect(getLiveRecorder()).toBe(FakeMediaRecorder.lastInstance)

      forceState(state)

      expect(getSnapshot().state).toBe(state)
      expect(getLiveRecorder()).toBeNull()
    }
  )

  test('failed recorder start does not poison later attach attempts', () => {
    FakeMediaRecorder.shouldThrowOnStart = true

    expect(() =>
      attachRecording()
    ).toThrow('start failed')

    expect(getSnapshot().state).toBe('idle')

    expect(() =>
      attachRecording()
    ).not.toThrow()
    expect(getSnapshot().state).toBe('recording')
  })

  test('recorder errors above the salvage threshold submit captured audio', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-encoder-salvage',
      outcome: 'started',
    })
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    attachRecording({
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    now.mockReturnValue(1_003_000)

    dispatchRecorderError(lastRecorder(), 'Encoder failure')
    dispatchStopDrain(lastRecorder(), 512)
    await flushAsync()

    expect(getSnapshot()).toMatchObject({
      state: 'submitted',
      errorMessage: null,
      salvageMessage: 'Encoder failure Submitting what was recorded.',
    })
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
  })

  test('upload failures preserve finalized recording for retry', async () => {
    mockRunCaptureUpload
      .mockResolvedValueOnce({
        kind: 'failure',
        message: 'Upload failed',
      })
      .mockResolvedValueOnce({
        kind: 'success',
        projectId: 'project-1',
        outcome: 'started',
      })

    attachRecording({
      title: 'Retry me',
      keyTerms: ['alpha'],
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise

    expect(getSnapshot()).toMatchObject({
      state: 'error',
      errorMessage: 'Upload failed',
      canRetryUpload: true,
    })
    expect(hasUnsavedRecording()).toBe(true)

    const firstFile = mockRunCaptureUpload.mock.calls[0][0]
    expect(firstFile).toBeInstanceOf(File)
    expect(firstFile.size).toBe(4608)

    await retryFinalizedUpload()

    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(2)
    expect(mockRunCaptureUpload.mock.calls[1][0]).toBe(firstFile)
    expect(getSnapshot()).toMatchObject({
      state: 'submitted',
      canRetryUpload: false,
      submissionResult: {
        projectId: 'project-1',
        outcome: 'started',
      },
    })
    expect(hasUnsavedRecording()).toBe(false)
  })

  test('discard during upload aborts the uploader and ignores late success', async () => {
    let uploadSignal: AbortSignal | undefined
    let resolveUpload:
      | ((result: {
          kind: 'success'
          projectId: string
          outcome: 'started'
        }) => void)
      | undefined
    mockRunCaptureUpload.mockImplementation((_file, _title, _keyTerms, options) => {
      uploadSignal = options?.signal
      return new Promise((resolve) => {
        resolveUpload = resolve
      })
    })

    attachRecording({
      title: 'Discard during upload',
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await Promise.resolve()

    expect(getSnapshot().state).toBe('uploading')
    expect(uploadSignal?.aborted).toBe(false)

    discard()

    expect(uploadSignal?.aborted).toBe(true)

    resolveUpload?.({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })
    await stopPromise

    expect(getSnapshot()).toMatchObject({
      state: 'discarded',
      submissionResult: null,
    })
    expect(hasUnsavedRecording()).toBe(false)
  })

  test('late recorder chunks after finalized file creation are ignored', async () => {
    let resolveUpload:
      | ((result: {
          kind: 'success'
          projectId: string
          outcome: 'started'
        }) => void)
      | undefined
    mockRunCaptureUpload.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveUpload = resolve
      })
    })

    attachRecording({
      title: 'Late chunk',
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const recorder = lastRecorder()
    const stopPromise = stopAndFinalize()
    dispatchStopDrain(recorder, 512)
    await Promise.resolve()

    expect(getSnapshot().state).toBe('uploading')

    dispatchChunk(recorder, 1024)

    resolveUpload?.({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })
    await stopPromise

    expect(mockRunCaptureUpload.mock.calls[0][0]).toBeInstanceOf(File)
    expect(mockRunCaptureUpload.mock.calls[0][0].size).toBe(4608)
    expect(getSnapshot().state).toBe('submitted')
  })

  test('resetRecordingSession clears retryable upload error state', async () => {
    mockRunCaptureUpload.mockResolvedValueOnce({
      kind: 'failure',
      message: 'Upload failed',
    })

    attachRecording({
      title: 'Reset retry',
      maxBytes: 1024 * 1024,
    })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise

    expect(getSnapshot()).toMatchObject({
      state: 'error',
      canRetryUpload: true,
    })

    resetRecordingSession()

    expect(getSnapshot()).toMatchObject({
      state: 'idle',
      canRetryUpload: false,
    })
    expect(getLiveRecorder()).toBeNull()
    expect(hasUnsavedRecording()).toBe(false)
  })
})
