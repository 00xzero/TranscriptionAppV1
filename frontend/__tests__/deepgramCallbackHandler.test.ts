/** @jest-environment node */

/**
 * The Deepgram callback handler: the result its route stored is linked and
 * handed off from that file, with Inngest's retries. A step cut off mid-way
 * (its receipt left held) is waited out and resumed, without Deepgram's help.
 */

import { InngestTestEngine } from '@inngest/test'

const mockReadState = jest.fn()
const mockHandoffState = jest.fn()
const mockRecord = jest.fn()
const mockConfirm = jest.fn()
const mockRemove = jest.fn()
const mockSend = jest.fn()
const mockInsert = jest.fn()
const mockFallback = jest.fn()

jest.mock('@/lib/inngest/engine-callback-state', () => ({
  readEngineCallbackState: (...a: unknown[]) => mockReadState(...a),
  engineHandoffState: (...a: unknown[]) => mockHandoffState(...a),
}))
jest.mock('@/core/transcription/webhook', () => ({
  recordEngineResult: (...a: unknown[]) => mockRecord(...a),
  confirmReceiptCompleted: (...a: unknown[]) => mockConfirm(...a),
}))
jest.mock('@/infra/supabase/transcription-results.server', () => ({
  removeTranscriptionResult: (...a: unknown[]) => mockRemove(...a),
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

import { handleDeepgramCallback, onDeepgramCallbackFailure } from '@/lib/inngest/functions/handle-deepgram-callback'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const requestId = 'deepgram-request-1'
const resultKey = `${userId}/${transcriptId}/${jobId}.json.gz`

function run() {
  const engine = new InngestTestEngine({ function: handleDeepgramCallback })
  return engine.execute({
    events: [{ name: 'deepgram/callback', data: { transcriptId, jobId, requestId, userId } }],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadState.mockResolvedValue({ state: 'fresh' })
  mockRecord.mockResolvedValue({ outcome: 'processed', attemptId: 'attempt-1' })
  mockConfirm.mockResolvedValue(true)
  mockRemove.mockResolvedValue(undefined)
  mockInsert.mockResolvedValue({ error: null })
  mockSend.mockResolvedValue({ ids: ['evt'] })
})

describe('handleDeepgramCallback', () => {
  test('hands off the stored file for the exact attempt, never uploading it again, and confirms it', async () => {
    const { result } = await run()

    expect(mockReadState).toHaveBeenCalledWith(expect.anything(), 'deepgram', { transcriptId, jobId, requestId })
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'deepgram',
      jobId,
      requestId,
      transcriptId,
      storedObjectKey: resultKey,
    }))
    expect(mockRecord.mock.calls[0][0].rawBody).toBeUndefined()
    expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), 'deepgram', requestId, 'attempt-1')
    expect(result).toEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('a file linked by an attempt that was cut off resumes from it', async () => {
    mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: resultKey })

    await run()

    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ storedObjectKey: resultKey }))
    expect(mockConfirm).toHaveBeenCalled()
  })

  test('a handoff that cannot be confirmed yet is retried', async () => {
    mockConfirm.mockResolvedValue(false)

    const { error } = await run()

    expect(error).toBeTruthy()
  })

  test('a duplicate needs no confirmation of its own', async () => {
    mockRecord.mockResolvedValue({ outcome: 'duplicate' })

    const { result } = await run()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('a receipt held by a killed attempt: the retry is a RetryAfterError that waits past its lease', async () => {
    mockRecord.mockResolvedValue({ outcome: 'retrying', retryAfter: 30, leaseRemainingMs: 200_000 })

    const { error } = await run()

    expect((error as { name?: string }).name).toBe('RetryAfterError')
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  test('a refused link (released receipt) is retried', async () => {
    mockRecord.mockResolvedValue({ outcome: 'retrying', retryAfter: 30 })

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  test('a storing error is retried', async () => {
    mockRecord.mockResolvedValue({ outcome: 'error', reason: 'Takeover failed' })

    const { error } = await run()

    expect(error).toBeTruthy()
  })

  test('an attempt that changed after the check writes and confirms nothing more', async () => {
    mockRecord.mockResolvedValue({ outcome: 'stale' })

    const { result } = await run()

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ status: 'stale' }))
  })

  test('before its request id is saved it throws, so Inngest retries', async () => {
    mockReadState.mockResolvedValue({ state: 'not_ready' })

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  test('a transcript deleted here: the file at the job\'s key is removed, nothing else written', async () => {
    mockReadState.mockResolvedValue({ state: 'gone' })

    const { result } = await run()

    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), resultKey, expect.any(String))
    expect(mockRecord).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ status: 'forgotten' }))
  })

  test('a removal that fails is retried', async () => {
    mockReadState.mockResolvedValue({ state: 'gone' })
    mockRemove.mockRejectedValue(new Error('storage down'))

    const { error } = await run()

    expect(error).toBeTruthy()
  })

  test.each([
    ['stale', { state: 'stale', otherRequest: false }],
    ['an orphaned start', { state: 'stale', otherRequest: true }],
    ['handled already', { state: 'handled' }],
  ])('%s: nothing is written or removed', async (_label, state) => {
    mockReadState.mockResolvedValue(state)

    await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockConfirm).not.toHaveBeenCalled()
  })
})

describe('onDeepgramCallbackFailure', () => {
  const failure = (message = 'db down') =>
    onDeepgramCallbackFailure({
      event: { data: { event: { data: { transcriptId, jobId, requestId, userId } } } },
      error: new Error(message),
    })

  test('with nothing linked it fails the job', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: false, jobExists: true })

    await failure()

    expect(mockHandoffState).toHaveBeenCalledWith(expect.anything(), 'deepgram', { jobId, requestId })
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      name: 'transcription/failed',
      data: expect.objectContaining({ transcriptId, jobId, errorType: 'transcription_error' }),
    }))
  })

  test('a linked result whose handoff is unconfirmed is recorded, and the job left alone', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: true, jobExists: true })

    await failure()

    expect(mockSend).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event_name: 'deepgram/handoff_unconfirmed', job_id: jobId }))
  })

  test('when the failure event cannot be sent, the job is failed directly', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: false, jobExists: true })
    mockSend.mockRejectedValue(new Error('Inngest down'))

    await failure()

    expect(mockFallback).toHaveBeenCalledWith(expect.objectContaining({ transcriptId, jobId, context: 'handleDeepgramCallback/onFailure' }))
  })

  test('a state that cannot be read throws, so the failure handler retries', async () => {
    mockHandoffState.mockRejectedValue(new Error('db down'))

    await expect(failure()).rejects.toThrow('db down')
  })
})
