import { createRecorderController } from '@/lib/recording/recorderController'
import {
  FakeMediaRecorder,
  createFakeStream,
  dispatchChunk,
  dispatchStop,
  installMediaRecorderMock,
} from '../../__mocks__/MediaRecorder'

function makeController() {
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
  return {
    chunks,
    controller,
    recorder: FakeMediaRecorder.lastInstance as FakeMediaRecorder,
  }
}

function trackStop(controller: ReturnType<typeof makeController>['controller']) {
  const onResolved = jest.fn()
  const stopPromise = controller.stop().then(onResolved)
  return { onResolved, stopPromise }
}

function chunkSizes(chunks: Blob[]): number[] {
  return chunks.map((chunk) => chunk.size)
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
}

describe('recorder controller', () => {
  beforeEach(() => {
    // autoDispatchStop stays false: these tests dispatch `stop` / `dataavailable`
    // manually to assert the controller's drain ordering.
    installMediaRecorderMock()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('waits for stop after a final dataavailable event arrives first', async () => {
    const { chunks, controller, recorder } = makeController()
    const { onResolved, stopPromise } = trackStop(controller)

    dispatchChunk(recorder, 20)
    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    dispatchStop(recorder)
    await stopPromise
    expect(chunkSizes(chunks)).toEqual([20])
    controller.dispose()
  })

  test('waits for final dataavailable after the stop event arrives first', async () => {
    const { chunks, controller, recorder } = makeController()
    const { onResolved, stopPromise } = trackStop(controller)

    dispatchStop(recorder)
    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    dispatchChunk(recorder, 20)
    await stopPromise
    expect(chunkSizes(chunks)).toEqual([20])
    controller.dispose()
  })

  test('resolves through the stop-drain fallback when no final chunk arrives', async () => {
    jest.useFakeTimers()
    const { chunks, controller, recorder } = makeController()
    const { onResolved, stopPromise } = trackStop(controller)

    dispatchStop(recorder)
    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    jest.advanceTimersByTime(250)
    await stopPromise
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([])
    controller.dispose()
  })

  test('resolves through the stop watchdog when the stop event never arrives', async () => {
    jest.useFakeTimers()
    const { chunks, controller } = makeController()
    const { onResolved, stopPromise } = trackStop(controller)

    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    jest.advanceTimersByTime(2_999)
    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    await stopPromise
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([])
    controller.dispose()
  })

  test('manual requestData chunks immediately before stop do not satisfy final drain', async () => {
    const { chunks, controller, recorder } = makeController()
    controller.requestData()
    const { onResolved, stopPromise } = trackStop(controller)

    dispatchChunk(recorder, 10)
    dispatchStop(recorder)
    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    dispatchChunk(recorder, 20)
    await stopPromise
    expect(chunkSizes(chunks)).toEqual([10, 20])
    controller.dispose()
  })

  test('inactive recorders still wait for a queued final chunk before resolving stop', async () => {
    const { chunks, controller, recorder } = makeController()
    recorder.state = 'inactive'
    const { onResolved, stopPromise } = trackStop(controller)

    await flushMicrotasks()
    expect(onResolved).not.toHaveBeenCalled()

    dispatchChunk(recorder, 20)
    await stopPromise
    expect(chunkSizes(chunks)).toEqual([20])
    controller.dispose()
  })
})
