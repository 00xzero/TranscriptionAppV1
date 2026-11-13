jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))
jest.mock('@/lib/recording/downloadRecording', () => ({ downloadRecording: jest.fn() }))

import { runCaptureUpload, type CaptureUploadResult } from '@/lib/capture/upload'
import {
  __resetForTesting,
  __setSnapshotForTesting,
  attachAndStart,
  cancelRecordingUpload,
  closeRecoveryForAccountChange,
  discard,
  discardRecovered,
  finalize,
  exportRecovered,
  forceState,
  getFinalizedRecordingFile,
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
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '@/contracts/transcription-options'
import { downloadRecording } from '@/lib/recording/downloadRecording'
import { LOCAL_CLEANUP_TIMEOUT_MS } from '@/lib/recording/cleanupDeadline'
import { hasConfirmedHandoffInPage } from '@/lib/recording/confirmedHandoff'

const mockRunCaptureUpload = jest.mocked(runCaptureUpload)
const DEFAULT_CODEC = { mime: 'audio/webm', extension: 'webm' } as const
const RECOVERED_OPTIONS = { engine: 'deepgram', language: 'pt', detect_speakers: true, keep_filler_words: false, mask_profanity: true } as const

async function attachRecording(
  overrides: Partial<AttachAndStartParams> = {}
): Promise<void> {
  await attachAndStart({
    stream: createFakeStream(),
    codec: DEFAULT_CODEC,
    title: null,
    keyTerms: [],
    transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
    projectId: null,
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
      transcriptId: 'transcript-1',
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
      transcriptId: 'transcript-1',
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

  test.each([
    ['soniox', 5 * 60 * 60 * 1000],
    ['assemblyai', 10 * 60 * 60 * 1000],
  ] as const)('warns and stops %s on chunk delivery without a timer tick', async (engine, capMs) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockRunCaptureUpload.mockResolvedValue({
      kind: 'failure',
      message: 'Temporary upload error',
    })
    await attachRecording({
      transcriptionOptions: { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine },
      maxBytes: 1024 * 1024,
    })
    const recorder = lastRecorder()
    const stop = jest.spyOn(recorder, 'stop')
    const stopAt = 1_000_000 + capMs - 60_000

    now.mockReturnValue(stopAt - 300_001)
    dispatchChunk(recorder, 4096)
    expect(getSnapshot().durationWarning).toBe(false)
    now.mockReturnValue(stopAt - 300_000)
    dispatchChunk(recorder, 512)
    expect(getSnapshot().durationWarning).toBe(true)
    now.mockReturnValue(stopAt - 1)
    dispatchChunk(recorder, 512)
    expect(stop).not.toHaveBeenCalled()
    now.mockReturnValue(stopAt)
    dispatchChunk(recorder, 512)
    expect(getSnapshot()).toMatchObject({
      state: 'finalizing',
      autoStopReason: 'duration',
      durationWarning: false,
    })

    dispatchStopDrain(recorder, 512)
    await flushAsync()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
    expect(mockRunCaptureUpload.mock.calls[0][0].size).toBe(6144)
    expect(mockRunCaptureUpload.mock.calls[0][3]?.transcriptionOptions?.engine).toBe(engine)
    expect(getSnapshot()).toMatchObject({
      state: 'error',
      canRetryUpload: true,
      autoStopReason: 'duration',
    })
  })

  test('starts a new recording without duration flags after an automatic stop', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const stopAt = 1_000_000 + 5 * 60 * 60 * 1000 - 60_000
    const options = {
      transcriptionOptions: { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine: 'soniox' as const },
      maxBytes: 1024 * 1024,
    }
    mockRunCaptureUpload.mockResolvedValue({ kind: 'success', transcriptId: 't1', outcome: 'started' })
    await attachRecording(options)
    now.mockReturnValue(stopAt - 1000)
    dispatchChunk(lastRecorder(), 4096)
    expect(getSnapshot().durationWarning).toBe(true)

    now.mockReturnValue(stopAt)
    dispatchChunk(lastRecorder(), 512)
    dispatchStopDrain(lastRecorder(), 512)
    await flushAsync()
    expect(getSnapshot()).toMatchObject({ state: 'submitted', autoStopReason: 'duration' })

    now.mockReturnValue(stopAt + 1000)
    await attachRecording(options)
    expect(getSnapshot()).toMatchObject({
      state: 'recording',
      durationWarning: false,
      autoStopReason: null,
    })
  })

  test('resume turns on the duration warning when active time is in the warning window', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const stopAt = 1_000_000 + 5 * 60 * 60 * 1000 - 60_000
    await attachRecording({
      transcriptionOptions: { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine: 'soniox' },
      maxBytes: 1024 * 1024,
    })
    const recorder = lastRecorder()
    const resumeRecorder = jest.spyOn(recorder, 'resume')

    now.mockReturnValue(stopAt - 1000)
    pause()
    expect(getSnapshot().durationWarning).toBe(false)
    now.mockReturnValue(stopAt + 1000)
    resume()

    expect(resumeRecorder).toHaveBeenCalledTimes(1)
    expect(getSnapshot()).toMatchObject({
      state: 'recording',
      durationWarning: true,
      autoStopReason: null,
    })
    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
  })

  test('ignores paused wall time and stops before resuming if active time already crossed the limit', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const stopAtMs = 5 * 60 * 60 * 1000 - 60_000
    mockRunCaptureUpload.mockResolvedValue({ kind: 'success', transcriptId: 't1', outcome: 'started' })
    await attachRecording({
      transcriptionOptions: { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine: 'soniox' },
      maxBytes: 1024 * 1024,
    })
    const recorder = lastRecorder()
    const resumeRecorder = jest.spyOn(recorder, 'resume')
    dispatchChunk(recorder, 4096)

    now.mockReturnValue(1_000_000 + stopAtMs - 500)
    pause()
    now.mockReturnValue(1_000_000 + stopAtMs + 300_000)
    resume()
    expect(getSnapshot().state).toBe('recording')
    expect(resumeRecorder).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + stopAtMs + 300_500)
    pause()
    resume()
    expect(getSnapshot()).toMatchObject({ state: 'finalizing', autoStopReason: 'duration' })
    expect(resumeRecorder).toHaveBeenCalledTimes(1)
    dispatchStopDrain(recorder, 512)
    await flushAsync()
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['deepgram', 4096, null],
    ['deepgram', 9700, 'size'],
    ['soniox', 9700, 'size'],
  ] as const)('uses the byte guard for %s with %s bytes even after the duration threshold', async (engine, bytes, reason) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockRunCaptureUpload.mockResolvedValue({ kind: 'success', transcriptId: 't1', outcome: 'started' })
    await attachRecording({
      transcriptionOptions: { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine },
      maxBytes: 10_000,
    })
    now.mockReturnValue(1_000_000 + 10 * 60 * 60 * 1000)
    const recorder = lastRecorder()
    dispatchChunk(recorder, bytes)
    expect(getSnapshot()).toMatchObject({
      state: reason ? 'finalizing' : 'recording',
      autoStopReason: reason,
      durationWarning: false,
    })
    if (reason) {
      dispatchStopDrain(recorder, 512)
      await flushAsync()
      expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
    }
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

  test('unexpected upload rejection becomes a retryable upload error', async () => {
    mockRunCaptureUpload.mockRejectedValueOnce(new Error('network exploded'))

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()

    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise

    expect(getSnapshot()).toMatchObject({
      state: 'error',
      errorMessage: 'network exploded',
      canRetryUpload: true,
    })
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

  test('uploading carries the bytes sent and drops them on leaving the state', async () => {
    let options: Parameters<typeof runCaptureUpload>[3] | undefined
    let resolveUpload: (
      result: Awaited<ReturnType<typeof runCaptureUpload>>
    ) => void = () => {}
    mockRunCaptureUpload.mockImplementationOnce((_file, _title, _terms, opts) => {
      options = opts
      return new Promise((resolve) => {
        resolveUpload = resolve
      })
    })

    await attachRecording({ title: 'X', maxBytes: 1024 * 1024 })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await flushAsync()

    expect(getSnapshot().state).toBe('uploading')
    expect(getSnapshot().uploadBytes).toBeNull()

    options?.onProgress?.('uploading')
    expect(getSnapshot().uploadBytes).toEqual({ sent: 0, total: 4608 })
    options?.onUploadBytes?.(2048, 4608)
    expect(getSnapshot().uploadBytes).toEqual({ sent: 2048, total: 4608 })

    resolveUpload({ kind: 'failure', message: 'upload boom' })
    await stopPromise
    expect(getSnapshot().state).toBe('error')
    expect(getSnapshot().uploadBytes).toBeNull()

    // A late report from the finished upload changes nothing.
    options?.onUploadBytes?.(4608, 4608)
    expect(getSnapshot().uploadBytes).toBeNull()
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
      acquire: jest.fn(async (sessionId: string) => ({ sessionId, release })),
      isHeld: jest.fn(async () => false),
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
      transcriptId: 'transcript-encoder-salvage',
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
        transcriptId: 'transcript-1',
        outcome: 'started',
      })

    await attachRecording({
      title: 'Retry me',
      keyTerms: ['alpha'],
      transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
      projectId: 'project-1',
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
    expect(mockRunCaptureUpload.mock.calls[0][3]).toMatchObject({ projectId: 'project-1' })
    expect(mockRunCaptureUpload.mock.calls[1][3]).toMatchObject({ projectId: 'project-1' })
    expect(getSnapshot()).toMatchObject({
      state: 'submitted',
      canRetryUpload: false,
      submissionResult: {
        transcriptId: 'transcript-1',
        outcome: 'started',
      },
    })
    expect(hasUnsavedRecording()).toBe(false)
  })

  test.each(['single_transfer', 'linking'] as const)(
    'stale cancel and teardown actions cannot interrupt %s',
    async (phase) => {
      let uploadSignal: AbortSignal | undefined
      let resolveUpload!: (result: CaptureUploadResult) => void
      mockRunCaptureUpload.mockImplementation((_file, _title, _keyTerms, options) => {
        uploadSignal = options.signal
        options.onTransferPhase?.(phase)
        return new Promise((resolve) => { resolveUpload = resolve })
      })
      await attachRecording({ maxBytes: 1024 * 1024 })
      dispatchChunk(lastRecorder(), 8192)
      advanceClockPastEmptyFloor()
      const stopped = stopAndFinalize()
      dispatchStopDrain(lastRecorder(), 512)
      await Promise.resolve()
      expect(getSnapshot()).toMatchObject({ state: 'uploading', uploadPhase: phase })

      cancelRecordingUpload()
      discard()
      resetRecordingSession()
      markInterrupted()
      markError('stale')
      expect(getSnapshot()).toMatchObject({ state: 'uploading', uploadPhase: phase })
      expect(uploadSignal?.aborted).toBe(false)

      resolveUpload({ kind: 'success', transcriptId: 't1', outcome: 'started' })
      await stopped
      expect(getSnapshot()).toMatchObject({ state: 'submitted', uploadPhase: null })
    }
  )

  test('cancel before linking keeps the finalized audio retryable', async () => {
    mockRunCaptureUpload.mockImplementation((_file, _title, _keyTerms, options) => {
      options.onTransferPhase?.('uploading')
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => resolve({ kind: 'failure', message: 'Upload canceled.' }))
      })
    })
    await attachRecording({ maxBytes: 1024 * 1024 })
    dispatchChunk(lastRecorder(), 8192)
    advanceClockPastEmptyFloor()
    const stopped = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await Promise.resolve()
    expect(getSnapshot().uploadPhase).toBe('uploading')

    cancelRecordingUpload()
    await stopped
    expect(getSnapshot()).toMatchObject({
      state: 'error', errorMessage: 'Upload canceled.', canRetryUpload: true, uploadPhase: null,
    })
  })

  test('late recorder chunks after finalized file creation are ignored', async () => {
    let resolveUpload:
      | ((result: {
          kind: 'success'
          transcriptId: string
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
      transcriptId: 'transcript-1',
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
      acquire: jest.fn(async (sessionId: string) => ({ sessionId, release })),
      isHeld: jest.fn(async () => false),
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

  async acquire(sessionId: string) {
    if (this.held) return null
    this.held = sessionId
    return { sessionId, release: async () => {
      this.releaseCount++
      this.held = null
    } }
  }

  async isHeld(sessionId: string): Promise<boolean> {
    return this.held === sessionId
  }

}

class DelayedDeletePersistence extends InMemorySessionPersistence {
  deleteStarted: Promise<void>
  deleteFinished: Promise<void>
  releaseDelete!: () => void
  private resolveDeleteStarted!: () => void
  private resolveDeleteFinished!: () => void
  private firstDelete = true

  constructor() {
    super()
    this.deleteStarted = new Promise((resolve) => {
      this.resolveDeleteStarted = resolve
    })
    this.deleteFinished = new Promise((resolve) => {
      this.resolveDeleteFinished = resolve
    })
  }

  override async deleteSession(sessionId: string, canDelete?: () => boolean, signal?: AbortSignal): Promise<void> {
    if (!this.firstDelete) return super.deleteSession(sessionId, canDelete, signal)
    this.firstDelete = false
    this.resolveDeleteStarted()
    await new Promise<void>((resolve) => {
      this.releaseDelete = resolve
    })
    try {
      await super.deleteSession(sessionId, canDelete, signal)
    } finally {
      this.resolveDeleteFinished()
    }
  }
}

class FailingDeletePersistence extends InMemorySessionPersistence {
  override async deleteSession(): Promise<void> {
    throw new Error('delete failed')
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

  async function seedRecovery(sessionId: string, overrides: Partial<PersistedSession> = {}) {
    const then = Date.now() - 60_000
    await persistence.putSession({
      sessionId, userId: 'user-123', uploadIntentId: `intent-${sessionId}`,
      projectId: null, title: 'Recovered title', generatedTitle: null, keyTerms: [],
      transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
      codecMime: 'audio/webm', codecExtension: 'webm', deviceId: null,
      createdAt: then, startedAt: then, lastResumeAt: null,
      pausedAccumulatedMs: 3000, bytesSoFar: 8192, lastChunkSeq: 0,
      lastChunkReceivedAt: then, phase: 'capturing', armed: true, failureReason: null,
      ...overrides,
    })
    await persistence.putChunk(sessionId, 0, new Blob([new Uint8Array(8192)]))
  }

  beforeEach(() => {
    __resetForTesting()
    mockRunCaptureUpload.mockReset()
    jest.mocked(downloadRecording).mockReset()
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

  test('attachAndStart stops waiting for a stalled recovery probe without starting the recorder', async () => {
    jest.useFakeTimers()
    try {
      await seedRecovery('pending')
      __setSnapshotForTesting({ state: 'submitted' })
      const listSessions = persistence.listSessions.bind(persistence)
      let unblock!: () => void
      const blocked = new Promise<void>((resolve) => { unblock = resolve })
      jest.spyOn(persistence, 'listSessions').mockImplementationOnce(async () => {
        await blocked
        return listSessions()
      })
      const probe = runRecoveryProbe()
      const start = expect(attachRecording()).rejects.toThrow('Recording recovery is taking longer than expected')

      await jest.advanceTimersByTimeAsync(LOCAL_CLEANUP_TIMEOUT_MS)
      await start
      expect(getSnapshot().state).toBe('submitted')
      expect(FakeMediaRecorder.lastInstance).toBeNull()

      unblock()
      await expect(probe).resolves.toBe(true)
      expect(getSnapshot().recoverable?.sessionId).toBe('pending')
      await expect(attachRecording()).rejects.toMatchObject({ code: 'recovery_pending' })
    } finally {
      jest.useRealTimers()
    }
  })

  test('an account switch keeps the recording and skips the upload', async () => {
    mockRunCaptureUpload.mockResolvedValue({ kind: 'failure', message: 'Account changed' })
    await attachRecording({ title: 'Patch auth', maxBytes: 1024 * 1024 })
    setIdentity({ userId: 'user-late', ready: true })
    await flushAsync()
    expect((await persistence.listSessions())[0].userId).toBe('user-123')
    recordChunk(new Blob([new Uint8Array(10_000)]))
    advanceClockPastEmptyFloor()
    const stopPromise = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopPromise
    expect(runCaptureUpload).not.toHaveBeenCalled()
    expect(getSnapshot()).toMatchObject({ state: 'error', canRetryUpload: true })
    expect((await persistence.listSessions())[0].userId).toBe('user-123')
  })

  test.each([0, 1024])('a recorder failure on a frozen page settles %i bytes without uploading', async (bytes) => {
    const ownerLock = new FakeOwnerLock()
    const presence = new FakeRecordingPresence()
    __setOwnerLockForTesting(ownerLock)
    __setPresenceForTesting(presence)
    await attachRecording({ maxBytes: 1024 * 1024 })
    const recorder = lastRecorder()
    setIdentity({ userId: 'user-123', ready: true, accountChanged: true })
    dispatchRecorderError(recorder, 'Microphone disconnected.')
    dispatchStopDrain(recorder, bytes)
    await flushAsync()

    expect(getSnapshot()).toMatchObject({ state: 'error', canRetryUpload: bytes > 0 })
    expect(getFinalizedRecordingFile()?.size ?? 0).toBe(bytes)
    expect(await ownerLock.isHeld()).toBe(false)
    expect(presence.read()).toBeNull()
    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
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
      projectId: null,
      title: 'Old orphan',
      generatedTitle: null,
      keyTerms: [],
      transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
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
    expect(lock.releaseCount).toBe(0)
    expect(await delayedPersistence.getSession(session.sessionId)).not.toBeNull()
  })

  test('a recovery probe releases nothing when identity changes before it acquired a claim', async () => {
    const delayedPersistence = new DelayedChunkStatsPersistence()
    installPersistence(delayedPersistence)
    const lock = new CountingSessionLock()
    __setSessionLockForTesting(lock)

    const session: PersistedSession = {
      sessionId: 'old-orphan',
      userId: 'user-123',
      uploadIntentId: 'intent-old',
      projectId: null,
      title: 'Old orphan',
      generatedTitle: null,
      keyTerms: [],
      transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
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
    setIdentity({ userId: 'user-456', ready: true })
    delayedPersistence.releaseRead()

    await expect(probe).resolves.toBe(false)
    expect(getSnapshot().state).toBe('idle')
    expect(lock.releaseCount).toBe(0)
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
      transcriptId: 'transcript-1',
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
      acquire: jest.fn(async (sessionId: string) => ({ sessionId, release })),
      isHeld: jest.fn(async () => false),
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
      transcriptId: 'transcript-1',
      outcome: 'started',
    })

    const chosen = { ...DEFAULT_TRANSCRIPTION_OPTIONS, language: 'nl' as const, detect_speakers: false }
    await attachRecording({ title: 'Saved cleanup', maxBytes: 1024 * 1024, transcriptionOptions: chosen })
    recordChunk(new Blob([new Uint8Array(4096)]))
    advanceClockPastEmptyFloor()
    await flushAsync()
    const [persisted] = await persistence.listSessions()
    expect(persisted.transcriptionOptions).toEqual(chosen)

    await stopAndFinalize()
    await flushAsync()

    expect(getSnapshot().state).toBe('submitted')
    expect(mockRunCaptureUpload.mock.calls[0][3]).toMatchObject({ transcriptionOptions: chosen })
    expect(await persistence.listSessions()).toEqual([])
  })

  test('successful recovered save clears the recoverable payload', async () => {
    const presence = new FakeRecordingPresence()
    __setPresenceForTesting(presence)
    const ownerLock = new FakeOwnerLock(false)
    __setOwnerLockForTesting(ownerLock)
    const releaseOwner = jest.spyOn(ownerLock, 'release')
    const session: PersistedSession = {
      sessionId: 'recoverable-1',
      userId: 'user-123',
      uploadIntentId: 'intent-1',
      projectId: 'project-recovered',
      title: 'Recovered title',
      generatedTitle: null,
      keyTerms: ['alpha'],
      transcriptionOptions: RECOVERED_OPTIONS,
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
      transcriptId: 'transcript-recovered',
      outcome: 'started',
      warning: 'project_missing',
    })
    expect(await runRecoveryProbe()).toBe(true)
    const remote = {
      userId: 'user-123', sessionId: 'another-tabs-live', ownerClientId: 'another-tab',
      state: 'recording' as const, title: 'Another tab', startedAt: 1_000,
      lastResumeAt: 1_000, pausedAccumulatedMs: 0, bytesSoFar: 8192, lastChunkSeq: 0,
      lastChunkReceivedAt: 1_000, heartbeatAt: 1_000,
    }
    presence.publish(remote)

    await expect(saveRecovered('Recovered title')).resolves.toEqual({ ok: true })
    expect(presence.read()).toEqual(remote)
    expect(releaseOwner).not.toHaveBeenCalled()

    expect(getSnapshot()).toMatchObject({
      state: 'submitted',
      recoverable: null,
      submissionResult: {
        transcriptId: 'transcript-recovered',
        outcome: 'started',
        warning: 'project_missing',
      },
    })
    expect(mockRunCaptureUpload.mock.calls[0][3]).toMatchObject({
      projectId: 'project-recovered',
      uploadIntentId: 'intent-1',
      transcriptionOptions: RECOVERED_OPTIONS,
    })
  })

  test.each([
    { kind: 'failure', message: 'Link unconfirmed' },
    { kind: 'success', transcriptId: 't1', outcome: 'saved_status_unknown' },
  ] satisfies CaptureUploadResult[])('settles the original claim after an account switch ($kind)', async (result) => {
    installPersistence(new FailingDeletePersistence())
    const lock = new CountingSessionLock()
    __setSessionLockForTesting(lock)
    await seedRecovery('interrupted-save')
    await runRecoveryProbe()

    let resolveUpload!: (result: CaptureUploadResult) => void
    mockRunCaptureUpload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    const save = saveRecovered('Original', 'interrupted-save')
    await flushAsync()
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)

    setIdentity({ userId: 'user-123', ready: true, accountChanged: true })
    closeRecoveryForAccountChange()
    expect(await lock.isHeld('interrupted-save')).toBe(true)
    resolveUpload(result)
    await save

    expect(await lock.isHeld('interrupted-save')).toBe(false)
    expect(getSnapshot().submissionResult).toBeNull()
    const persisted = await persistence.getSession('interrupted-save')
    expect(persisted?.cleanupOnly).toBe(result.kind === 'success' ? result.outcome : undefined)
    expect(await persistence.listChunkSeqs('interrupted-save')).toEqual([0])
  })

  test('an account switch during export suppresses the download and retains the audio', async () => {
    await seedRecovery('interrupted-export')
    await runRecoveryProbe()
    let finishRead!: (chunks: Blob[]) => void
    jest.spyOn(persistence, 'readChunks').mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve }))
    const exporting = exportRecovered('interrupted-export')
    setIdentity({ userId: 'user-123', ready: true, hasStopped: () => true })
    finishRead([new Blob([new Uint8Array(8192)])])
    await exporting
    expect(downloadRecording).not.toHaveBeenCalled()
    expect(await persistence.listChunkSeqs('interrupted-export')).toEqual([0])
    expect(getSnapshot().state).toBe('idle')
  })

  test.each([null, 'bad/key'])('a recovery with intent %p can be exported and discarded but cannot be saved', async (uploadIntentId) => {
    await seedRecovery('export-only', { uploadIntentId })
    await runRecoveryProbe()
    await expect(saveRecovered('Original', 'export-only')).resolves.toMatchObject({ ok: false })
    expect(mockRunCaptureUpload).not.toHaveBeenCalled()

    await exportRecovered('export-only')
    expect(downloadRecording).toHaveBeenCalledWith(expect.objectContaining({ name: 'recording.webm', size: 8192 }))
    expect(await persistence.listChunkSeqs('export-only')).toEqual([0])
    await discardRecovered('export-only')
    expect(await persistence.getSession('export-only')).toBeNull()
  })

  test('cancel while reading a recovered file keeps its claim and skips the network', async () => {
    await seedRecovery('cancel-read')
    await runRecoveryProbe()
    let finishRead!: (chunks: Blob[]) => void
    jest.spyOn(persistence, 'readChunks').mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve }))
    const saving = saveRecovered('Original', 'cancel-read')
    expect(getSnapshot()).toMatchObject({ state: 'recoverable', uploadPhase: 'preparing' })
    cancelRecordingUpload('another-row')
    expect(getSnapshot().uploadPhase).toBe('preparing')
    cancelRecordingUpload('cancel-read')
    expect(getSnapshot().uploadPhase).toBe('canceling')
    finishRead([new Blob([new Uint8Array(8192)])])

    await expect(saving).resolves.toEqual({ ok: false, message: 'Upload canceled.' })
    expect(mockRunCaptureUpload).not.toHaveBeenCalled()
    expect(getSnapshot()).toMatchObject({ state: 'recoverable', uploadPhase: null })
    expect(await persistence.listChunkSeqs('cancel-read')).toEqual([0])
  })

  test.each([false, true])('account switch at discard settlement (already committed: %s)', async (committed) => {
    await seedRecovery('discard-race')
    await runRecoveryProbe()
    const deleteSession = persistence.deleteSession.bind(persistence)
    let unblock!: () => void
    let entered!: () => void
    const began = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { unblock = resolve })
    jest.spyOn(persistence, 'deleteSession').mockImplementationOnce(async (id, canDelete) => {
      if (committed) await deleteSession(id, canDelete)
      entered()
      await blocked
      if (!committed) await deleteSession(id, canDelete)
    })
    const discarding = discardRecovered('discard-race')
    await began
    setIdentity({ userId: 'user-123', ready: true, accountChanged: true })
    unblock()
    if (committed) await expect(discarding).resolves.toBeUndefined()
    else await expect(discarding).rejects.toThrow('Recording deletion is no longer available.')
    expect(Boolean(await persistence.getSession('discard-race'))).toBe(!committed)
    expect(getSnapshot().state).toBe('idle')
  })

  test('a queued live discard retains its audio if the account freezes before deletion', async () => {
    const delayed = new DelayedDeletePersistence()
    installPersistence(delayed)
    await attachRecording({ maxBytes: 1024 * 1024 })
    dispatchChunk(lastRecorder(), 8192)
    discard()
    await delayed.deleteStarted
    setIdentity({ userId: 'user-123', ready: true, accountChanged: true })
    delayed.releaseDelete()
    await delayed.deleteFinished
    const [row] = await persistence.listSessions()
    expect(row?.userId).toBe('user-123')
    expect(await persistence.listChunkSeqs(row.sessionId)).toEqual([0])
  })

  test('a failed marker and deletion cannot expose another Save in the same page', async () => {
    await seedRecovery('both-failed')
    await seedRecovery('older', { createdAt: Date.now() - 120_000 })
    const patch = jest.spyOn(persistence, 'patchSession').mockRejectedValueOnce(new Error('marker failed'))
    const deleteSession = persistence.deleteSession.bind(persistence)
    const remove = jest.spyOn(persistence, 'deleteSession').mockImplementation((id, canDelete) =>
      id === 'both-failed' ? Promise.reject(new Error('delete failed')) : deleteSession(id, canDelete)
    )
    mockRunCaptureUpload.mockResolvedValueOnce({ kind: 'success', transcriptId: 't1', outcome: 'started' })
    await runRecoveryProbe()
    await expect(saveRecovered('Original', 'both-failed')).resolves.toEqual({ ok: true })
    expect(getSnapshot().recoverable?.sessionId).toBe('older')
    await discardRecovered('older')

    expect(getSnapshot().state).toBe('idle')
    expect(await persistence.getSession('both-failed')).not.toBeNull()
    patch.mockRestore()
    remove.mockRestore()
    await expect(runRecoveryProbe()).resolves.toBe(false)
    expect(await persistence.getSession('both-failed')).toBeNull()
    expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
  })

  test('persists a confirmed live handoff even when the queue downgraded', async () => {
    installPersistence(new FailingChunkPersistence())
    jest.spyOn(persistence, 'deleteSession').mockRejectedValue(new Error('delete failed'))
    mockRunCaptureUpload.mockResolvedValueOnce({
      kind: 'success', transcriptId: 't1', outcome: 'saved_needs_retry',
    })
    await attachRecording({ maxBytes: 1024 * 1024 })
    dispatchChunk(lastRecorder(), 8192)
    await flushAsync()
    expect(getSnapshot().durable).toBe(false)
    advanceClockPastEmptyFloor()
    const stopped = stopAndFinalize()
    dispatchStopDrain(lastRecorder(), 512)
    await stopped
    expect((await persistence.listSessions())[0]).toMatchObject({ cleanupOnly: 'saved_needs_retry' })
  })

  test.each(['queue', 'marker', 'delete'] as const)(
    'finishes a confirmed save while local %s work stalls',
    async (stage) => {
      jest.useFakeTimers()
      try {
        const sessionLock = new CountingSessionLock()
        const ownerLock = new FakeOwnerLock()
        __setSessionLockForTesting(sessionLock)
        __setOwnerLockForTesting(ownerLock)
        mockRunCaptureUpload.mockResolvedValue({
          kind: 'success', transcriptId: 't1', outcome: 'started',
        })
        await attachRecording({ maxBytes: 1024 * 1024 })
        await jest.advanceTimersByTimeAsync(0)
        const [row] = await persistence.listSessions()

        let unblock!: () => void
        const blocked = new Promise<void>((resolve) => { unblock = resolve })
        if (stage === 'queue') {
          const putChunk = persistence.putChunk.bind(persistence)
          jest.spyOn(persistence, 'putChunk').mockImplementationOnce(async (...args) => {
            await blocked
            await putChunk(...args)
          })
        } else if (stage === 'marker') {
          const patchSession = persistence.patchSession.bind(persistence)
          jest.spyOn(persistence, 'patchSession').mockImplementation(async (...args) => {
            if (args[1].cleanupOnly) await blocked
            await patchSession(...args)
          })
        } else {
          const deleteSession = persistence.deleteSession.bind(persistence)
          jest.spyOn(persistence, 'deleteSession').mockImplementationOnce(async (...args) => {
            await blocked
            await deleteSession(...args)
          })
        }
        dispatchChunk(lastRecorder(), 8192)
        advanceClockPastEmptyFloor()
        const stopped = stopAndFinalize()
        dispatchStopDrain(lastRecorder(), 512)
        await jest.advanceTimersByTimeAsync(0)
        expect(getSnapshot().uploadPhase).toBe('settling')

        await jest.advanceTimersByTimeAsync(LOCAL_CLEANUP_TIMEOUT_MS)
        await stopped
        expect(getSnapshot()).toMatchObject({ state: 'submitted', uploadPhase: null })
        expect(sessionLock.held).toBeNull()
        expect(await ownerLock.isHeld()).toBe(false)

        unblock()
        await jest.advanceTimersByTimeAsync(0)
        const remaining = await persistence.getSession(row.sessionId)
        expect(remaining?.cleanupOnly).toBe(stage === 'delete' ? 'started' : undefined)
        expect(remaining !== null).toBe(true)
        expect(hasConfirmedHandoffInPage(row.sessionId, row.userId!)).toBe(stage !== 'delete')
        if (stage === 'queue') expect(await persistence.listChunkSeqs(row.sessionId)).toEqual([])
      } finally {
        jest.useRealTimers()
      }
    }
  )

  test.each([false, true])('a recovered save settles at the deadline and only re-probes for the same account (switched: %s)', async (switched) => {
    jest.useFakeTimers()
    try {
      const delayed = new DelayedDeletePersistence()
      installPersistence(delayed)
      const lock = new CountingSessionLock()
      __setSessionLockForTesting(lock)
      await seedRecovery('saved')
      await seedRecovery('pending', { createdAt: Date.now() - 120_000 })
      await expect(runRecoveryProbe()).resolves.toBe(true)
      expect(getSnapshot().recoverable).toMatchObject({ sessionId: 'saved', remainingCount: 1 })
      const listSessions = jest.spyOn(delayed, 'listSessions')
      mockRunCaptureUpload.mockResolvedValue({
        kind: 'success', transcriptId: 't1', outcome: 'saved_status_unknown',
      })
      const saving = saveRecovered('Recovered title', 'saved')
      await delayed.deleteStarted

      await jest.advanceTimersByTimeAsync(LOCAL_CLEANUP_TIMEOUT_MS)
      await expect(saving).resolves.toEqual({ ok: true })
      expect(getSnapshot()).toMatchObject({
        state: 'submitted', uploadPhase: null,
        submissionResult: { outcome: 'saved_status_unknown', recovered: true },
      })
      expect(lock.held).toBeNull()
      expect(listSessions).not.toHaveBeenCalled()

      if (switched) setIdentity({ userId: 'another-user', ready: true, accountChanged: true })
      delayed.releaseDelete()
      await delayed.deleteFinished
      expect(await delayed.getSession('saved')).toMatchObject({ cleanupOnly: 'saved_status_unknown' })

      await jest.advanceTimersByTimeAsync(0)
      if (switched) {
        expect(listSessions).not.toHaveBeenCalled()
        expect(lock.held).toBeNull()
        expect(getSnapshot().recoverable).toBeNull()
        return
      }
      expect(getSnapshot()).toMatchObject({
        state: 'recoverable',
        recoverable: { sessionId: 'pending' },
        submissionResult: { transcriptId: 't1', outcome: 'saved_status_unknown', recovered: true },
      })
      expect(lock.held).toBe('pending')
      expect(await delayed.getSession('saved')).toBeNull()
      expect(mockRunCaptureUpload).toHaveBeenCalledTimes(1)
      await expect(attachRecording()).rejects.toMatchObject({ code: 'recovery_pending' })
    } finally {
      jest.useRealTimers()
    }
  })

  test('discardRecovered surfaces local delete failure and keeps recovery open', async () => {
    const failingDelete = new FailingDeletePersistence()
    installPersistence(failingDelete)
    const now = Date.now()
    await failingDelete.putSession({
      sessionId: 'recoverable-1', userId: 'user-123', uploadIntentId: 'intent-1',
      projectId: null, title: 'Recovered title', generatedTitle: null, keyTerms: [],
      transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
      codecMime: 'audio/webm', codecExtension: 'webm', deviceId: null,
      createdAt: now - 60_000, startedAt: now - 60_000, lastResumeAt: null,
      pausedAccumulatedMs: 3000, bytesSoFar: 8192, lastChunkSeq: 0,
      lastChunkReceivedAt: now - 60_000, phase: 'capturing', armed: true, failureReason: null,
    })
    await failingDelete.putChunk('recoverable-1', 0, new Blob([new Uint8Array(8192)]))
    expect(await runRecoveryProbe()).toBe(true)

    await expect(discardRecovered()).rejects.toThrow('delete failed')
    expect(getSnapshot()).toMatchObject({
      state: 'recoverable',
      recoverable: {
        sessionId: 'recoverable-1',
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
      acquire: jest.fn(async (sessionId: string) => ({ sessionId, release: async () => {} }))
        .mockImplementationOnce(async (sessionId) => ({ sessionId, release })),
      isHeld: jest.fn(async () => false),
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
