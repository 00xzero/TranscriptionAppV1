jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import { runCaptureUpload } from '@/lib/capture/upload'
import {
  __resetForTesting,
  attachAndStart,
  checkCaptureHealth,
  finalize,
  getSnapshot,
  pause,
  recordChunk,
  resume,
} from '@/lib/recording/session'
import {
  FakeMediaRecorder,
  createFakeStream,
  getFakeTrack,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }
const START = 1_000_000
const STALE_MS = 4_000

async function attach(stream: MediaStream): Promise<void> {
  await attachAndStart({
    stream,
    codec: CODEC,
    title: 'Health',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

describe('capture-health watchdog', () => {
  let now: jest.SpyInstance<number, []>

  beforeEach(() => {
    __resetForTesting()
    jest.mocked(runCaptureUpload).mockReset()
    installMediaRecorderMock()
    setIdentity({ userId: 'user-1', ready: true })
    now = jest.spyOn(Date, 'now').mockReturnValue(START)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('first stale tick requests a flush without warning; second tick warns', async () => {
    const stream = createFakeStream()
    await attach(stream)
    const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder
    const flushSpy = jest.spyOn(recorder, 'requestData')

    now.mockReturnValue(START + STALE_MS + 100)

    // First stale tick: flush requested, no warning yet.
    checkCaptureHealth()
    expect(flushSpy).toHaveBeenCalledTimes(1)
    expect(getSnapshot().captureHealthWarning).toBeNull()

    // Second stale tick after the flush: passive warning surfaces.
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).toMatch(/audio/i)
    expect(getSnapshot().state).toBe('recording')
  })

  test('a resumed chunk clears the warning and the flush flag', async () => {
    const stream = createFakeStream()
    await attach(stream)

    now.mockReturnValue(START + STALE_MS + 100)
    checkCaptureHealth()
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).not.toBeNull()

    recordChunk(new Blob([new Uint8Array(2048)]))
    expect(getSnapshot().captureHealthWarning).toBeNull()

    // The flush flag reset means the next stall starts a fresh two-strike cycle.
    const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder
    const flushSpy = jest.spyOn(recorder, 'requestData')
    now.mockReturnValue(START + 2 * STALE_MS + 200)
    checkCaptureHealth()
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })

  test('pause, resume, and finalize clear stale capture warnings', async () => {
    const stream = createFakeStream()
    await attach(stream)

    now.mockReturnValue(START + STALE_MS + 100)
    checkCaptureHealth()
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).not.toBeNull()

    pause()
    expect(getSnapshot().captureHealthWarning).toBeNull()

    resume()
    expect(getSnapshot().captureHealthWarning).toBeNull()

    now.mockReturnValue(START + 2 * STALE_MS + 200)
    checkCaptureHealth()
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).not.toBeNull()

    finalize()
    expect(getSnapshot().state).toBe('finalizing')
    expect(getSnapshot().captureHealthWarning).toBeNull()
  })

  test('confirmed audio loss routes into the salvage policy', async () => {
    const stream = createFakeStream()
    await attach(stream)

    // Below the empty floor → salvage policy discards rather than uploads.
    now.mockReturnValue(START + STALE_MS + 100)
    getFakeTrack(stream).readyState = 'ended'

    checkCaptureHealth()

    expect(getSnapshot().state).toBe('discarded')
    expect(runCaptureUpload).not.toHaveBeenCalled()
  })

  test('long pause then resume does not instantly warn', async () => {
    const stream = createFakeStream()
    await attach(stream)

    // Record a chunk so the session is healthy, then pause well past the stale
    // window.
    recordChunk(new Blob([new Uint8Array(2048)]))
    now.mockReturnValue(START + 1_000)
    pause()
    now.mockReturnValue(START + 60_000) // long pause

    // Watchdog is inert while paused.
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).toBeNull()

    resume()
    // A tick right after resume must not register the long pause as a stall.
    checkCaptureHealth()
    expect(getSnapshot().captureHealthWarning).toBeNull()
    expect(getSnapshot().state).toBe('recording')
  })
})
