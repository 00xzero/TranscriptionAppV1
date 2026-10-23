/** @jest-environment node */

/**
 * The AssemblyAI callback handler (the shared fetching handler, as AssemblyAI
 * uses it): our records are read before anything is fetched, AssemblyAI's copy
 * is deleted only once ours is safe, and running out of retries never deletes
 * it.
 */

import { InngestTestEngine } from '@inngest/test'

const mockReadState = jest.fn()
const mockHandoffState = jest.fn()
const mockRecord = jest.fn()
const mockPersistFailure = jest.fn()
const mockConfirm = jest.fn()
const mockFetchTranscript = jest.fn()
const mockDelete = jest.fn()
const mockDownload = jest.fn()
const mockSend = jest.fn()
const mockInsert = jest.fn()
const mockFallback = jest.fn()

jest.mock('@/lib/inngest/engine-callback-state', () => ({
  readEngineCallbackState: (...a: unknown[]) => mockReadState(...a),
  engineHandoffState: (...a: unknown[]) => mockHandoffState(...a),
}))
jest.mock('@/core/transcription/webhook', () => ({
  recordEngineResult: (...a: unknown[]) => mockRecord(...a),
  persistWebhookFailure: (...a: unknown[]) => mockPersistFailure(...a),
  confirmReceiptCompleted: (...a: unknown[]) => mockConfirm(...a),
}))
jest.mock('@/infra/assemblyai', () => ({
  fetchAssemblyAITranscript: (...a: unknown[]) => mockFetchTranscript(...a),
  deleteAssemblyAITranscript: (...a: unknown[]) => mockDelete(...a),
}))
jest.mock('@/infra/supabase/transcription-results.server', () => ({
  downloadTranscriptionResult: (...a: unknown[]) => mockDownload(...a),
}))
jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }) }),
}))
jest.mock('@/lib/inngest/functions/_shared', () => ({
  writeTranscriptionFailureFallback: (...a: unknown[]) => mockFallback(...a),
}))
jest.mock('@/infra/inngest/client', () => {
  const actual = jest.requireActual('@/infra/inngest/client')
  return { ...actual, sendInngestEvent: (...a: unknown[]) => mockSend(...a) }
})

import { handleAssemblyAICallback, onAssemblyAICallbackFailure } from '@/lib/inngest/functions/handle-assemblyai-callback'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const requestId = 'aai-transcript-1'

const transcript = {
  id: requestId,
  status: 'completed',
  text: 'Hello.',
  words: [{ text: 'Hello.', start: 0, end: 400, confidence: 0.9, speaker: 'A' }],
  speech_model_used: 'universal-3-5-pro',
}

function run(status: 'completed' | 'error' = 'completed') {
  const engine = new InngestTestEngine({ function: handleAssemblyAICallback })
  return engine.execute({
    events: [{ name: 'assemblyai/callback', data: { transcriptId, jobId, requestId, status } }],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadState.mockResolvedValue({ state: 'fresh' })
  mockRecord.mockResolvedValue({ outcome: 'processed', attemptId: 'attempt-1' })
  mockConfirm.mockResolvedValue(true)
  mockPersistFailure.mockResolvedValue('job')
  mockFetchTranscript.mockResolvedValue({ raw: transcript, transcript })
  mockDelete.mockResolvedValue(undefined)
  mockInsert.mockResolvedValue({ error: null })
  mockSend.mockResolvedValue({ ids: ['evt'] })
})

describe('handleAssemblyAICallback', () => {
  test('a completed transcript: fetched, stored as AssemblyAI sent it for the exact attempt, then deleted at AssemblyAI', async () => {
    const { result } = await run()

    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'assemblyai',
      jobId,
      requestId,
      transcriptId,
      rawBody: JSON.stringify(transcript),
    }))
    expect(mockDelete).toHaveBeenCalledWith(requestId)
    expect(mockRecord.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
    expect(result).toEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('the handoff is confirmed on its receipt before AssemblyAI\'s copy is deleted', async () => {
    await run()

    expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), 'assemblyai', requestId, 'attempt-1')
    expect(mockConfirm.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
  })

  test('a handoff that cannot be confirmed yet is retried, and nothing is deleted', async () => {
    mockConfirm.mockResolvedValue(false)

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a duplicate needs no confirmation of its own', async () => {
    mockRecord.mockResolvedValue({ outcome: 'duplicate' })

    await run()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
  })

  test('a failed transcript: its error is recorded on the exact attempt, then it is deleted', async () => {
    const failed = { id: requestId, status: 'error', error: 'Transcoding failed. File type application/octet-stream (data) may be unsupported.', text: null, words: null }
    mockFetchTranscript.mockResolvedValue({ raw: failed, transcript: failed })

    await run('error')

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockPersistFailure).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'assemblyai',
      jobId,
      requestId,
      transcriptId,
      message: 'Transcription failed: Transcoding failed. File type application/octet-stream (data) may be unsupported.',
      detail: JSON.stringify({ status: 'error', error: failed.error }),
    }))
    expect(mockPersistFailure.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
  })

  test('a failure without a reason says AssemblyAI could not transcribe it', async () => {
    const failed = { id: requestId, status: 'error', error: null, text: null, words: null }
    mockFetchTranscript.mockResolvedValue({ raw: failed, transcript: failed })

    await run('error')

    expect(mockPersistFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Transcription failed: AssemblyAI could not transcribe the audio',
    }))
  })

  test('a "completed" callback for a transcript that is not completed stores nothing and deletes nothing', async () => {
    const processing = { ...transcript, status: 'processing' }
    mockFetchTranscript.mockResolvedValue({ raw: processing, transcript: processing })

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  describe('a retry of store-result, replaying a check that said fresh', () => {
    // Inngest replays a step's saved result on retry; here the saved check
    // says fresh while an earlier try has since stored our copy, or more.
    function retry() {
      const engine = new InngestTestEngine({ function: handleAssemblyAICallback })
      return engine.execute({
        events: [{ name: 'assemblyai/callback', data: { transcriptId, jobId, requestId, status: 'completed' } }],
        steps: [{ id: 'check', handler: () => ({ state: 'fresh' }) }],
      })
    }

    test('resumes from our stored copy without fetching from AssemblyAI, then deletes after the handoff', async () => {
      mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })
      mockFetchTranscript.mockRejectedValue(new Error('AssemblyAI API error: 503 - down'))

      const { result } = await retry()

      expect(mockFetchTranscript).not.toHaveBeenCalled()
      expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ storedObjectKey: 'user/t/job.json.gz' }))
      expect(mockRecord.mock.calls[0][0]).not.toHaveProperty('rawBody')
      expect(mockConfirm.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
      expect(result).toEqual(expect.objectContaining({ status: 'completed' }))
    })

    test('already handed off: stores nothing and only cleans up', async () => {
      mockReadState.mockResolvedValue({ state: 'handled' })

      await retry()

      expect(mockFetchTranscript).not.toHaveBeenCalled()
      expect(mockRecord).not.toHaveBeenCalled()
      expect(mockConfirm).not.toHaveBeenCalled()
      expect(mockDelete).toHaveBeenCalledWith(requestId)
    })

    test('gone stale meanwhile: touches nothing and keeps AssemblyAI\'s copy', async () => {
      mockReadState.mockResolvedValue({ state: 'stale', otherRequest: false })

      const { result } = await retry()

      expect(mockFetchTranscript).not.toHaveBeenCalled()
      expect(mockRecord).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({ status: 'stale' }))
    })
  })

  test('a cleanup AssemblyAI refuses is retried after the handoff, which is not redone', async () => {
    mockDelete.mockRejectedValue(new Error('AssemblyAI API error: 503 - down'))

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  })

  test('a late duplicate of a handled callback fetches nothing and deletes again harmlessly', async () => {
    mockReadState.mockResolvedValue({ state: 'handled' })

    await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
  })

  test('a callback for a transcript deleted here deletes AssemblyAI\'s copy', async () => {
    mockReadState.mockResolvedValue({ state: 'gone' })

    const { result } = await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
    expect(result).toEqual(expect.objectContaining({ status: 'forgotten' }))
  })

  test('a callback for a failed attempt fetches, writes and deletes nothing, keeping AssemblyAI\'s copy', async () => {
    mockReadState.mockResolvedValue({ state: 'stale', otherRequest: false })

    const { result } = await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ status: 'stale' }))
  })

  test('an orphaned start (another request replaced it) fetches and writes nothing, and only forgets it at AssemblyAI', async () => {
    mockReadState.mockResolvedValue({ state: 'stale', otherRequest: true })

    const { result } = await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
    expect(result).toEqual(expect.objectContaining({ status: 'stale' }))
  })

  test('a callback before the request id is saved throws, so Inngest retries', async () => {
    mockReadState.mockResolvedValue({ state: 'not_ready' })

    const { error } = await run()

    expect(String((error as Error)?.message ?? error)).toContain('has not saved AssemblyAI request')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a linked file whose hand-off failed resumes from our copy, without fetching or storing it again, and only then deletes', async () => {
    mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })

    await run()

    expect(mockFetchTranscript).not.toHaveBeenCalled()
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ storedObjectKey: 'user/t/job.json.gz' }))
    expect(mockRecord.mock.calls[0][0]).not.toHaveProperty('rawBody')
    expect(mockRecord.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
  })

  test('storing that fails between storage, link and hand-off is retried and deletes nothing', async () => {
    mockRecord.mockRejectedValue(new Error('send failed'))

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a receipt held by a killed attempt: the retry is a RetryAfterError, and nothing is deleted', async () => {
    mockRecord.mockResolvedValue({ outcome: 'retrying', retryAfter: 30, leaseRemainingMs: 240_000 })

    const { error } = await run()

    // The test engine hands the error back serialized: its name survives.
    expect((error as { name?: string }).name).toBe('RetryAfterError')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('an attempt that changed after the check (the write found it stale) confirms and deletes nothing', async () => {
    mockRecord.mockResolvedValue({ outcome: 'stale' })

    const { result } = await run()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ status: 'stale' }))
  })

  test('a failure that could not be recorded yet is retried, deleting nothing', async () => {
    mockPersistFailure.mockResolvedValue('nothing')

    const { error } = await run('error')

    expect(error).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('onAssemblyAICallbackFailure', () => {
  const failure = (message = 'AssemblyAI down') =>
    onAssemblyAICallbackFailure({
      event: { data: { event: { data: { transcriptId, jobId, requestId, status: 'completed' } } } },
      error: new Error(message),
    })

  test('before the hand-off it fails the exact job, and never deletes at AssemblyAI', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: false, jobExists: true })

    await failure()

    expect(mockSend).toHaveBeenCalledWith({
      name: 'transcription/failed',
      data: { transcriptId, jobId, error: 'AssemblyAI down', errorType: 'transcription_error' },
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('after the hand-off, a cleanup that kept failing is recorded, and the transcription is left alone', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: true, resultLinked: true, jobExists: true })

    await failure('delete refused')

    expect(mockSend).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'assemblyai/cleanup_failure',
      transcript_id: transcriptId,
      job_id: jobId,
      error_message: 'delete refused',
    }))
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a cleanup failure for a deleted transcript points at no rows', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: true, resultLinked: false, jobExists: false })

    await failure()

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ transcript_id: null, job_id: null }))
  })

  test('when the job event cannot be sent, the job is failed directly', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: false, jobExists: true })
    mockSend.mockRejectedValue(new Error('inngest down'))

    await failure()

    expect(mockFallback).toHaveBeenCalledWith(expect.objectContaining({ transcriptId, jobId }))
  })

  test('sent but with its receipt never completed, while deletion kept failing: the job is not failed', async () => {
    // recordEngineResult handed off (event sent) but its receipt finalize
    // failed, then cleanup ran out of retries with downstream still running.
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: true, jobExists: true })

    await failure('delete refused')

    expect(mockSend).not.toHaveBeenCalled()
    expect(mockFallback).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event_name: 'assemblyai/handoff_unconfirmed', job_id: jobId }))
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a state that cannot be read throws, so the failure handler retries instead of failing the job', async () => {
    mockHandoffState.mockRejectedValue(new Error('db down'))

    await expect(failure()).rejects.toThrow('db down')
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockFallback).not.toHaveBeenCalled()
  })
})
