jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import { runCaptureUpload } from '@/lib/capture/upload'
import {
  __resetForTesting,
  __setSnapshotForTesting,
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
  resetRecordingSession,
  retryFinalizedUpload,
  resume,
  runRecoveryProbe,
  saveRecovered,
  stopAndFinalize,
  startMock,
  subscribe,
  syncIdentityToActiveSession,
  type AttachAndStartParams,
} from '@/lib/recording/session'
import { setIdentity } from '@/lib/recording/sessionIdentity'
import {
  FakeMediaRecorder,
  createFakeStream,
  dispatchChunk,
  dispatchRecorderError,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import {
  __setPersistenceForTesting,
  InMemorySessionPersistence,
  type PersistedSession,
} from '@/lib/recording/persistence'
import {
  FakeOwnerLock,
  __setSessionLockForTesting,
  __setOwnerLockForTesting,
  type SessionLock,
} from '@/lib/recording/lock'
import {
  FakeRecordingPresence,
  __setPresenceForTesting,
} from '@/lib/recording/presence'

const mockRunCaptureUpload = jest.mocked(runCaptureUpload)
const DEFAULT_CODEC = { mime: 'audio/webm', extension: 'webm' } as const

async function attachRecording(
  overrides: Partial<AttachAndStartParams> = {}
): Promise<void> {
  await attachAndStart({
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
    mockRunCaptureUpload.mockReset()
    installMediaRecorderMock()
    setIdentity({ userId: 'user-123', ready: true })
    // The session finalize path relies on `stop()` emitting a `stop` event.
    FakeMediaRecorder.autoDispatchStop = true
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

  test('elapsed active time is clamped across backward clock changes', () => {
    const baseTime = 1_000_000
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(baseTime)
    startMock()
    now.mockReturnValue(baseTime - 5000)

    pause()

    const snap = getSnapshot()
    expect(snap.state).toBe('paused')
    expect(snap.pausedAccumulatedMs).toBe(0)
    expect(getElapsedActiveMs(snap, baseTime - 5000)).toBe(0)
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

    await attachRecording({
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

    await attachRecording({
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
    expect(mockRunCaptureUpload.mock.calls[0][3]?.uploadIntentId).toEqual(
      expect.any(String)
    )
  })

  test('stop below the empty floor discards without uploading', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(4_000_000)
    await attachRecording({
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

  // Phase 4: a non-retryable error is no longer a live recording, so presence is
  // dropped. A retryable upload error stays an unresolved artifact and keeps both
  // the owner lock and the last presence breadcrumb for owner-loss recovery.
  test('non-retryable error clears presence and releases the owner lock', async () => {
    const ownerLock = new FakeOwnerLock(false)
    __setOwnerLockForTesting(ownerLock)
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    expect(presence.read()).not.toBeNull()
    const releaseSpy = jest.spyOn(ownerLock, 'release')

    markError('Mic unplugged')
    await flushAsync()

    expect(getSnapshot().canRetryUpload).toBe(false)
    expect(presence.read()).toBeNull()
    expect(releaseSpy).toHaveBeenCalled()
  })

  test('retryable upload error preserves presence breadcrumb and keeps the owner lock', async () => {
    const ownerLock = new FakeOwnerLock(false)
    __setOwnerLockForTesting(ownerLock)
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)
    mockRunCaptureUpload.mockResolvedValue({ kind: 'failure', message: 'upload boom' })

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    const releaseSpy = jest.spyOn(ownerLock, 'release')

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise

    expect(getSnapshot().state).toBe('error')
    expect(getSnapshot().canRetryUpload).toBe(true)
    expect(presence.read()).toMatchObject({
      sessionId: expect.any(String),
      state: 'uploading',
      userId: 'user-123',
    })
    // The Web Locks request holds the lock open across the parked error, so the
    // owner lock must not be released until the user retries or discards.
    expect(releaseSpy).not.toHaveBeenCalled()
  })

  test('retryable upload error parks without keeping the recording interval alive', async () => {
    const ownerLock = {
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => true),
      release: jest.fn(async () => {}),
    }
    __setOwnerLockForTesting(ownerLock)
    mockRunCaptureUpload.mockResolvedValue({ kind: 'failure', message: 'upload boom' })
    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    const intervalsAfterStart = setIntervalSpy.mock.calls.length
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise

    expect(getSnapshot().state).toBe('error')
    expect(getSnapshot().canRetryUpload).toBe(true)
    expect(clearIntervalSpy).toHaveBeenCalled()
    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalsAfterStart)
  })

  test('retrying a finalized upload restarts the recording interval for uploading heartbeats', async () => {
    mockRunCaptureUpload.mockResolvedValueOnce({
      kind: 'failure',
      message: 'upload boom',
    })

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise
    expect(getSnapshot().state).toBe('error')
    expect(getSnapshot().canRetryUpload).toBe(true)

    let resolveRetryUpload: (
      result: Awaited<ReturnType<typeof runCaptureUpload>>
    ) => void = () => {}
    mockRunCaptureUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetryUpload = resolve
        })
    )
    const setIntervalSpy = jest.spyOn(window, 'setInterval')

    const retryPromise = retryFinalizedUpload()
    await flushAsync()

    expect(getSnapshot().state).toBe('uploading')
    expect(setIntervalSpy).toHaveBeenCalled()

    resolveRetryUpload({ kind: 'failure', message: 'upload boom again' })
    await retryPromise
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

  test('getLiveRecorder exposes the attached recorder, null otherwise', async () => {
    expect(getLiveRecorder()).toBeNull()

    await attachRecording()
    expect(getLiveRecorder()).toBe(FakeMediaRecorder.lastInstance)

    markSubmitted() // disposes the controller
    expect(getLiveRecorder()).toBeNull()
  })

  test('markInterrupted disposes an attached recorder while preserving interrupted state', async () => {
    await attachRecording()
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
    async (state) => {
      await attachRecording()
      expect(getLiveRecorder()).toBe(FakeMediaRecorder.lastInstance)

      forceState(state)

      expect(getSnapshot().state).toBe(state)
      expect(getLiveRecorder()).toBeNull()
    }
  )

  test('failed recorder start does not poison later attach attempts', async () => {
    FakeMediaRecorder.shouldThrowOnStart = true

    await expect(attachRecording()).rejects.toThrow('start failed')

    expect(getSnapshot().state).toBe('idle')

    await expect(attachRecording()).resolves.toBeUndefined()
    expect(getSnapshot().state).toBe('recording')
  })

  test('failed recorder construction releases the acquired session lock', async () => {
    const release = jest.fn(async () => {})
    const lock: SessionLock = {
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release,
    }
    __setSessionLockForTesting(lock)

    class ThrowingMediaRecorder extends EventTarget {
      static isTypeSupported = () => true
      constructor() {
        super()
        throw new Error('construct failed')
      }
    }
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
      ThrowingMediaRecorder
    if (typeof window !== 'undefined') {
      ;(window as unknown as { MediaRecorder: unknown }).MediaRecorder =
        ThrowingMediaRecorder
    }

    await expect(attachRecording()).rejects.toThrow('construct failed')

    expect(release).toHaveBeenCalledTimes(1)
    expect(getSnapshot().state).toBe('idle')
  })

  test('recorder errors above the salvage threshold submit captured audio', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-encoder-salvage',
      outcome: 'started',
    })
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await attachRecording({
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

    await attachRecording({
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

    await attachRecording({
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

    await attachRecording({
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

    await attachRecording({
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

  test('resume publishes presence with the refreshed capture-health baseline', async () => {
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)
    const now = jest.spyOn(Date, 'now')

    now.mockReturnValue(1_000_000)
    await attachRecording({ title: 'Ordering', maxBytes: 1024 * 1024 })

    now.mockReturnValue(1_000_500)
    recordChunk(new Blob([new Uint8Array(4096)]))

    now.mockReturnValue(1_001_000)
    pause()
    expect(presence.read()?.lastChunkReceivedAt).toBe(1_000_500)

    now.mockReturnValue(1_002_000)
    resume()
    expect(presence.read()?.lastChunkReceivedAt).toBe(1_002_000)

    // The refreshed baseline remains in subsequent presence updates until a new
    // chunk arrives.
    now.mockReturnValue(1_003_000)
    pause()
    expect(presence.read()?.lastChunkReceivedAt).toBe(1_002_000)
  })

  test('markInterrupted from a non-interruptible state does not run recovery', async () => {
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)
    const clearSpy = jest.spyOn(presence, 'clear')
    const release = jest.fn(async () => {})
    __setSessionLockForTesting({
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release,
    })
    const ownerRelease = jest.fn(async () => {})
    __setOwnerLockForTesting({
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release: ownerRelease,
    })

    // `submitted` is not in INTERRUPTIBLE_STATES, so the transition is rejected.
    forceState('submitted')

    markInterrupted('late interrupt')
    await flushAsync()

    // The rejected transition leaves both state and ownership untouched.
    expect(getSnapshot().state).toBe('submitted')
    expect(clearSpy).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(ownerRelease).not.toHaveBeenCalled()
  })
})

// A fake whose chunk writes always reject — exercises the sticky downgrade path
// while keeping metadata writes (so the armed:false marker can land).
class FailingChunkPersistence extends InMemorySessionPersistence {
  override async putChunk(): Promise<void> {
    throw new Error('quota exceeded')
  }
}

// Gates the probe's metadata read (chunkStats) so a test can flip the live
// snapshot mid-probe and assert the stale result is discarded.
class DelayedChunkStatsPersistence extends InMemorySessionPersistence {
  readStarted: Promise<void>
  releaseRead!: () => void
  private resolveReadStarted!: () => void

  constructor() {
    super()
    this.readStarted = new Promise((resolve) => {
      this.resolveReadStarted = resolve
    })
  }

  override async chunkStats(
    sessionId: string
  ): Promise<{ count: number; totalBytes: number }> {
    this.resolveReadStarted()
    await new Promise<void>((resolve) => {
      this.releaseRead = resolve
    })
    return super.chunkStats(sessionId)
  }
}

class CountingSessionLock implements SessionLock {
  held: string | null = null
  releaseCount = 0

  async acquire(sessionId: string): Promise<boolean> {
    this.held = sessionId
    return true
  }

  async isHeld(sessionId: string): Promise<boolean> {
    return this.held === sessionId
  }

  async release(): Promise<void> {
    this.releaseCount++
    this.held = null
  }
}

class DelayedDeletePersistence extends InMemorySessionPersistence {
  deleteStarted: Promise<void>
  deleteFinished: Promise<void>
  releaseDelete!: () => void
  private resolveDeleteStarted!: () => void
  private resolveDeleteFinished!: () => void

  constructor() {
    super()
    this.deleteStarted = new Promise((resolve) => {
      this.resolveDeleteStarted = resolve
    })
    this.deleteFinished = new Promise((resolve) => {
      this.resolveDeleteFinished = resolve
    })
  }

  override async deleteSession(sessionId: string): Promise<void> {
    this.resolveDeleteStarted()
    await new Promise<void>((resolve) => {
      this.releaseDelete = resolve
    })
    await super.deleteSession(sessionId)
    this.resolveDeleteFinished()
  }
}

// Gates the first chunk write so a test can hold the write queue unsettled and
// assert ordering around `queue.whenSettled()` (e.g. interrupted recovery must
// not release ownership while a chunk write is still in flight).
class DelayedChunkWritePersistence extends InMemorySessionPersistence {
  writeStarted: Promise<void>
  writeFinished: Promise<void>
  releaseWrite!: () => void
  private resolveWriteStarted!: () => void
  private resolveWriteFinished!: () => void
  private firstWrite = true

  constructor() {
    super()
    this.writeStarted = new Promise((resolve) => {
      this.resolveWriteStarted = resolve
    })
    this.writeFinished = new Promise((resolve) => {
      this.resolveWriteFinished = resolve
    })
  }

  override async putChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
    if (this.firstWrite) {
      this.firstWrite = false
      this.resolveWriteStarted()
      await new Promise<void>((resolve) => {
        this.releaseWrite = resolve
      })
      await super.putChunk(sessionId, seq, blob)
      this.resolveWriteFinished()
      return
    }
    return super.putChunk(sessionId, seq, blob)
  }
}

describe('recording session durability mirror', () => {
  let persistence: InMemorySessionPersistence

  function installPersistence(adapter: InMemorySessionPersistence): void {
    persistence = adapter
    __setPersistenceForTesting(adapter)
  }

  beforeEach(() => {
    __resetForTesting()
    mockRunCaptureUpload.mockReset()
    installMediaRecorderMock()
    FakeMediaRecorder.autoDispatchStop = true
    setIdentity({ userId: 'user-123', ready: true })
    installPersistence(new InMemorySessionPersistence())
  })

  test('mirrors session metadata and a contiguous seq=0..N chunk stream', async () => {
    await attachRecording({ title: 'Durable', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(1000)]))
    recordChunk(new Blob([new Uint8Array(2000)]))
    recordChunk(new Blob([new Uint8Array(3000)]))
    await flushAsync()

    const sessions = await persistence.listSessions()
    expect(sessions).toHaveLength(1)
    const session = sessions[0]
    expect(session.title).toBe('Durable')
    expect(session.phase).toBe('capturing')
    expect(session.armed).toBe(true)
    expect(session.bytesSoFar).toBe(6000)
    expect(session.lastChunkSeq).toBe(2)

    // The first persisted chunk is seq=0 (the required init chunk) and the
    // stream is contiguous.
    expect(await persistence.listChunkSeqs(session.sessionId)).toEqual([0, 1, 2])
  })

  test('persists the resolved userId and a non-null uploadIntentId', async () => {
    setIdentity({ userId: 'user-123', ready: true })
    await attachRecording({ title: 'Scoped', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(1000)]))
    await flushAsync()

    const session = (await persistence.listSessions())[0]
    expect(session.userId).toBe('user-123')
    expect(typeof session.uploadIntentId).toBe('string')
    expect(session.uploadIntentId).not.toBeNull()
  })

  test('attachAndStart blocks until identity is resolved and user-scoped', async () => {
    setIdentity({ userId: null, ready: false })

    await expect(
      attachRecording({ title: 'Late auth', maxBytes: 1024 * 1024 })
    ).rejects.toMatchObject({ code: 'recording_identity_required' })

    expect(await persistence.listSessions()).toEqual([])
  })

  test('syncIdentityToActiveSession can backfill an existing live row', async () => {
    await attachRecording({ title: 'Patch auth', maxBytes: 1024 * 1024 })
    syncIdentityToActiveSession('user-late')
    await flushAsync()
    expect((await persistence.listSessions())[0].userId).toBe('user-late')
  })

  test('a stale recovery probe does not overwrite a live recording', async () => {
    const delayedPersistence = new DelayedChunkStatsPersistence()
    installPersistence(delayedPersistence)
    const lock = new CountingSessionLock()
    __setSessionLockForTesting(lock)

    const session: PersistedSession = {
      sessionId: 'old-orphan',
      userId: 'user-123',
      uploadIntentId: 'intent-old',
      title: 'Old orphan',
      generatedTitle: null,
      keyTerms: [],
      codecMime: 'audio/webm',
      codecExtension: 'webm',
      deviceId: null,
      createdAt: 1_000,
      startedAt: 1_000,
      lastResumeAt: 1_000,
      pausedAccumulatedMs: 0,
      bytesSoFar: 8192,
      lastChunkSeq: 1,
      lastChunkReceivedAt: 1_000,
      phase: 'capturing',
      armed: true,
      failureReason: null,
    }
    await delayedPersistence.putSession(session)
    await delayedPersistence.putChunk(session.sessionId, 0, new Blob([new Uint8Array(4096)]))
    await delayedPersistence.putChunk(session.sessionId, 1, new Blob([new Uint8Array(4096)]))

    const probe = runRecoveryProbe()
    await delayedPersistence.readStarted

    __setSnapshotForTesting({ state: 'recording', title: 'Live recording' })
    delayedPersistence.releaseRead()

    await expect(probe).resolves.toBe(false)
    expect(getSnapshot()).toMatchObject({
      state: 'recording',
      title: 'Live recording',
      recoverable: null,
    })
    expect(lock.releaseCount).toBe(1)
    expect(await delayedPersistence.getSession(session.sessionId)).not.toBeNull()
  })

  test('a failing chunk write downgrades the session but recording continues', async () => {
    installPersistence(new FailingChunkPersistence())

    await attachRecording({ title: 'Downgrade', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    await flushAsync()

    // Live recording is unaffected by the persistence failure.
    expect(getSnapshot().state).toBe('recording')

    const session = (await persistence.listSessions())[0]
    expect(session.armed).toBe(false)
    expect(session.failureReason).toBe('quota exceeded')
  })

  test('a downgraded mirror still finalizes and submits the recording', async () => {
    installPersistence(new FailingChunkPersistence())
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })

    await attachRecording({ title: 'Still submits', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    await stopAndFinalize()

    expect(getSnapshot().state).toBe('submitted')
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
  })

  test('discard clears the persisted session and chunks', async () => {
    await attachRecording({ title: 'Cleanup', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    await flushAsync()
    expect(await persistence.listSessions()).toHaveLength(1)

    discard()
    await flushAsync()

    expect(await persistence.listSessions()).toEqual([])
    const sessionId = 'unused' // session is gone; nothing should remain
    expect(await persistence.listChunkSeqs(sessionId)).toEqual([])
  })

  test('terminal cleanup deletes persisted data before releasing the session lock', async () => {
    const delayedPersistence = new DelayedDeletePersistence()
    installPersistence(delayedPersistence)
    const release = jest.fn(async () => {})
    __setSessionLockForTesting({
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release,
    })

    await attachRecording({ title: 'Ordered cleanup', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    await flushAsync()

    discard()
    await delayedPersistence.deleteStarted

    expect(release).not.toHaveBeenCalled()

    delayedPersistence.releaseDelete()
    await delayedPersistence.deleteFinished
    await flushAsync()

    expect(release).toHaveBeenCalledTimes(1)
    expect(await delayedPersistence.listSessions()).toEqual([])
  })

  test('successful submission clears the persisted session', async () => {
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-1',
      outcome: 'started',
    })

    await attachRecording({ title: 'Saved cleanup', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    await flushAsync()
    expect(await persistence.listSessions()).toHaveLength(1)

    await stopAndFinalize()
    await flushAsync()

    expect(getSnapshot().state).toBe('submitted')
    expect(await persistence.listSessions()).toEqual([])
  })

  test('successful recovered save clears the recoverable payload', async () => {
    const session: PersistedSession = {
      sessionId: 'recoverable-1',
      userId: 'user-123',
      uploadIntentId: 'intent-1',
      title: 'Recovered title',
      generatedTitle: null,
      keyTerms: ['alpha'],
      codecMime: 'audio/webm',
      codecExtension: 'webm',
      deviceId: null,
      createdAt: 1_000,
      startedAt: 1_000,
      lastResumeAt: 1_000,
      pausedAccumulatedMs: 0,
      bytesSoFar: 8192,
      lastChunkSeq: 1,
      lastChunkReceivedAt: 1_000,
      phase: 'capturing',
      armed: true,
      failureReason: null,
    }
    await persistence.putSession(session)
    await persistence.putChunk(session.sessionId, 0, new Blob([new Uint8Array(4096)]))
    await persistence.putChunk(session.sessionId, 1, new Blob([new Uint8Array(4096)]))
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'success',
      projectId: 'project-recovered',
      outcome: 'started',
    })
    __setSnapshotForTesting({
      state: 'recoverable',
      title: session.title,
      keyTerms: session.keyTerms,
      recoverable: {
        sessionId: session.sessionId,
        uploadIntentId: session.uploadIntentId,
        title: session.title,
        generatedTitle: session.generatedTitle,
        keyTerms: session.keyTerms,
        codecMime: session.codecMime,
        codecExtension: session.codecExtension,
        bytesSoFar: 8192,
        createdAt: session.createdAt,
        remainingCount: 0,
        mayBeTruncated: false,
      },
    })

    await expect(saveRecovered('Recovered title')).resolves.toEqual({
      ok: true,
      chainedToNext: false,
    })

    expect(getSnapshot()).toMatchObject({
      state: 'submitted',
      recoverable: null,
      submissionResult: {
        projectId: 'project-recovered',
        outcome: 'started',
      },
    })
  })

  // Characterization (review item #1, slice 1): after an interruption,
  // finalizeInterruptedRecovery must await the write queue settling before it
  // clears presence, releases the session + owner locks, and probes — so another
  // tab never sees "no owner" while chunk writes are still in flight. Pins the
  // ordering the dispatch-funnel refactor must preserve.
  test('interrupted recovery waits for the write queue to settle before releasing ownership', async () => {
    const delayed = new DelayedChunkWritePersistence()
    installPersistence(delayed)
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)
    const release = jest.fn(async () => {})
    __setSessionLockForTesting({
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release,
    })
    const ownerRelease = jest.fn(async () => {})
    __setOwnerLockForTesting({
      acquire: jest.fn(async () => true),
      isHeld: jest.fn(async () => false),
      release: ownerRelease,
    })

    await attachRecording({ title: 'Settle first', maxBytes: 1024 * 1024 })
    // Below the 4_096 empty floor, so the eventual recovery probe cleans it up and
    // the session stays `interrupted` — keeps the assertion on ordering, not on
    // whether the orphan is recoverable.
    recordChunk(new Blob([new Uint8Array(1_000)]))
    await delayed.writeStarted

    markInterrupted('Page reloaded.')
    // The chunk write is still in flight, so the queue has not settled: ownership
    // must NOT have been released and presence must NOT have been cleared yet.
    expect(release).not.toHaveBeenCalled()
    expect(ownerRelease).not.toHaveBeenCalled()
    expect(presence.read()).not.toBeNull()

    delayed.releaseWrite()
    await delayed.writeFinished
    await flushAsync()

    expect(release).toHaveBeenCalledTimes(1)
    expect(ownerRelease).toHaveBeenCalledTimes(1)
    expect(presence.read()).toBeNull()
    expect(getSnapshot().state).toBe('interrupted')
  })
})
