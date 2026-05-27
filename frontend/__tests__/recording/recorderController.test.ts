import { createRecorderController } from '@/lib/recording/recorderController'

class FakeMediaRecorder extends EventTarget {
  static lastInstance: FakeMediaRecorder | null = null
  state: RecordingState = 'inactive'

  constructor(_stream: MediaStream, _options: MediaRecorderOptions) {
    super()
    FakeMediaRecorder.lastInstance = this
  }

  start(): void {
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
  }
}

function createFakeStream(): MediaStream {
  const track = Object.assign(new EventTarget(), {
    stop: jest.fn(),
  }) as unknown as MediaStreamTrack

  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

function dispatchChunk(recorder: EventTarget, bytes: number): void {
  const event = new Event('dataavailable')
  Object.defineProperty(event, 'data', {
    value: new Blob([new Uint8Array(bytes)]),
  })
  recorder.dispatchEvent(event)
}

describe('recorder controller', () => {
  beforeEach(() => {
    FakeMediaRecorder.lastInstance = null
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: FakeMediaRecorder,
    })
  })

  test('manual requestData chunks do not satisfy the final stop drain', async () => {
    const chunks: Blob[] = []
    const controller = createRecorderController(
      createFakeStream(),
      'audio/webm',
      {
        onChunk: (blob) => chunks.push(blob),
        onError: jest.fn(),
        onTrackEnded: jest.fn(),
        onTrackMutedSustained: jest.fn(),
      }
    )
    controller.start(1000)
    controller.requestData()

    let resolved = false
    const stopPromise = controller.stop().then(() => {
      resolved = true
    })
    const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder

    dispatchChunk(recorder, 10)
    recorder.dispatchEvent(new Event('stop'))
    await Promise.resolve()
    expect(resolved).toBe(false)

    dispatchChunk(recorder, 20)
    await stopPromise
    expect(chunks.map((chunk) => chunk.size)).toEqual([10, 20])
  })

  test('inactive recorders still wait for a queued final chunk before resolving stop', async () => {
    const chunks: Blob[] = []
    const controller = createRecorderController(
      createFakeStream(),
      'audio/webm',
      {
        onChunk: (blob) => chunks.push(blob),
        onError: jest.fn(),
        onTrackEnded: jest.fn(),
        onTrackMutedSustained: jest.fn(),
      }
    )
    controller.start(1000)

    const recorder = FakeMediaRecorder.lastInstance as FakeMediaRecorder
    recorder.state = 'inactive'

    let resolved = false
    const stopPromise = controller.stop().then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    dispatchChunk(recorder, 20)
    await stopPromise
    expect(chunks.map((chunk) => chunk.size)).toEqual([20])
  })
})
