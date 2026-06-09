import {
  __resetCaptureUploaderForTesting,
  __resetForTesting,
  __setCaptureUploaderForTesting,
  attachAndStart,
  getSnapshot,
  recordChunk,
} from '@/lib/recording/session'
import {
  FakeMediaRecorder,
  createFakeStream,
  dispatchChunk,
  dispatchRecorderError,
  getFakeTrack,
  installMediaRecorderMock,
} from '../../__mocks__/MediaRecorder'

const mockRunCaptureUpload = jest.fn()
const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

function attach(stream: MediaStream): void {
  attachAndStart({
    stream,
    codec: CODEC,
    title: 'Salvage me',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

// Let the upload promise chain (controller.stop -> submit -> uploader) settle.
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function dispatchStopDrain(manualBytes: number): void {
  const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder
  dispatchChunk(recorder, manualBytes)
  dispatchChunk(recorder, 0)
}

describe('recorder-failure salvage policy', () => {
  beforeEach(() => {
    __resetForTesting()
    __setCaptureUploaderForTesting(mockRunCaptureUpload)
    mockRunCaptureUpload.mockReset()
    installMediaRecorderMock()
    // Salvage routes through stopAndFinalize, which needs `stop` to emit.
    FakeMediaRecorder.autoDispatchStop = true
  })

  afterEach(() => {
    __resetCaptureUploaderForTesting()
    jest.restoreAllMocks()
  })

  test('track end above the empty floor auto-submits with a banner', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'p1',
      outcome: 'started',
    })
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)

    const stream = createFakeStream()
    attach(stream)
    recordChunk(new Blob([new Uint8Array(8192)])) // >= 4 KB
    now.mockReturnValue(1_003_000) // >= 2 s active

    getFakeTrack(stream).dispatchEvent(new Event('ended'))
    // Resolve the controller's final-chunk drain so the stop promise settles.
    dispatchStopDrain(256)
    await flushAsync()

    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
    expect(getSnapshot().salvageMessage).toMatch(/Submitting what was recorded/i)
    expect(getSnapshot().state).toBe('submitted')
  })

  test('track end below the empty floor discards with a banner', () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(2_000_000)

    const stream = createFakeStream()
    attach(stream)
    recordChunk(new Blob([new Uint8Array(100)])) // < 4 KB
    now.mockReturnValue(2_000_500) // < 2 s active

    getFakeTrack(stream).dispatchEvent(new Event('ended'))

    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
    expect(getSnapshot().state).toBe('discarded')
    expect(getSnapshot().salvageMessage).toMatch(/discarded/i)
  })

  test('recorder error above the empty floor auto-submits with a banner', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'p-recorder-error',
      outcome: 'started',
    })
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(2_500_000)

    const stream = createFakeStream()
    attach(stream)
    recordChunk(new Blob([new Uint8Array(8192)])) // >= 4 KB
    now.mockReturnValue(2_503_000) // >= 2 s active

    dispatchRecorderError(
      FakeMediaRecorder.lastInstance as FakeMediaRecorder,
      'Encoder failed.'
    )
    // Resolve the controller's final-chunk drain so the stop promise settles.
    dispatchStopDrain(256)
    await flushAsync()

    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
    expect(getSnapshot().salvageMessage).toMatch(/Encoder failed/i)
    expect(getSnapshot().state).toBe('submitted')
  })

  test('sustained mute above the floor salvages after the debounce', () => {
    jest.useFakeTimers()
    try {
      mockRunCaptureUpload.mockResolvedValue({
        kind: 'success',
        projectId: 'p2',
        outcome: 'started',
      })
      const now = jest.spyOn(Date, 'now')
      now.mockReturnValue(3_000_000)

      const stream = createFakeStream()
      attach(stream)
      recordChunk(new Blob([new Uint8Array(8192)])) // >= 4 KB
      now.mockReturnValue(3_003_000) // >= 2 s active

      getFakeTrack(stream).dispatchEvent(new Event('mute'))
      // The controller debounces sustained mute (3 s) before reporting it.
      jest.advanceTimersByTime(3_000)

      // The salvage banner is set synchronously before the async upload begins.
      expect(getSnapshot().salvageMessage).toMatch(/quiet/i)
      expect(getSnapshot().state).not.toBe('recording')
    } finally {
      jest.useRealTimers()
    }
  })
})
