import {
  getSnapshot,
  restartInterruptedRecording,
  __resetForTesting,
} from '@/lib/recording/session'
import {
  installMediaRecorderMock,
  FakeMediaRecorder,
} from '../../__mocks__/MediaRecorder'
import {
  installGetUserMediaMock,
  resetGetUserMediaMock,
} from '../../__mocks__/getUserMedia'

const originalUserAgent = navigator.userAgent
const originalVendor = navigator.vendor

function setSafariNavigator(): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  })
  Object.defineProperty(navigator, 'vendor', {
    configurable: true,
    value: 'Apple Computer, Inc.',
  })
}

function resetNavigator(): void {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent,
  })
  Object.defineProperty(navigator, 'vendor', {
    configurable: true,
    value: originalVendor,
  })
}

describe('restartInterruptedRecording', () => {
  beforeEach(() => {
    jest.useRealTimers()
    __resetForTesting()
    installMediaRecorderMock()
    installGetUserMediaMock()
    window.sessionStorage.setItem(
      'recording.sessionDraft',
      JSON.stringify({
        title: 'Recovered recording',
        generatedTitle: null,
        keyTerms: [],
        codecMime: 'audio/webm',
        deviceId: null,
      })
    )
  })

  afterEach(() => {
    jest.useRealTimers()
    __resetForTesting()
    resetGetUserMediaMock()
    resetNavigator()
  })

  test('prewarms Safari mic before attaching a restarted recording', async () => {
    jest.useFakeTimers()
    setSafariNavigator()

    const restartPromise = restartInterruptedRecording(1024)

    await jest.advanceTimersByTimeAsync(0)

    expect(getSnapshot().state).toBe('idle')
    expect(FakeMediaRecorder.lastInstance).toBeNull()

    await jest.advanceTimersByTimeAsync(3999)

    expect(getSnapshot().state).toBe('idle')
    expect(FakeMediaRecorder.lastInstance).toBeNull()

    await jest.advanceTimersByTimeAsync(1)

    await expect(restartPromise).resolves.toEqual({ ok: true })
    expect(getSnapshot().state).toBe('recording')
    expect(FakeMediaRecorder.lastInstance).not.toBeNull()
  })
})
