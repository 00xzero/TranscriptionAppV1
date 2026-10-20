/** @jest-environment node */

/**
 * The Soniox callback handler: our records are read before anything is
 * fetched, Soniox's copy is deleted only once ours is safe, and running out of
 * retries never deletes it.
 */

import { InngestTestEngine } from '@inngest/test'

const mockReadState = jest.fn()
const mockHandoffState = jest.fn()
const mockRecord = jest.fn()
const mockPersistFailure = jest.fn()
const mockConfirm = jest.fn()
const mockFetchTranscription = jest.fn()
const mockFetchTranscript = jest.fn()
const mockDelete = jest.fn()
const mockDownload = jest.fn()
const mockSend = jest.fn()
const mockInsert = jest.fn()
const mockFallback = jest.fn()

jest.mock('@/lib/inngest/soniox-callback-state', () => ({
  readSonioxCallbackState: (...a: unknown[]) => mockReadState(...a),
  sonioxHandoffState: (...a: unknown[]) => mockHandoffState(...a),
}))
jest.mock('@/core/transcription/webhook', () => ({
  recordEngineResult: (...a: unknown[]) => mockRecord(...a),
  persistWebhookFailure: (...a: unknown[]) => mockPersistFailure(...a),
  confirmReceiptCompleted: (...a: unknown[]) => mockConfirm(...a),
}))
jest.mock('@/infra/soniox', () => ({
  fetchSonioxTranscription: (...a: unknown[]) => mockFetchTranscription(...a),
  fetchSonioxTranscript: (...a: unknown[]) => mockFetchTranscript(...a),
  deleteSonioxTranscription: (...a: unknown[]) => mockDelete(...a),
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

import { handleSonioxCallback, onSonioxCallbackFailure } from '@/lib/inngest/functions/handle-soniox-callback'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const requestId = 'soniox-job-1'

const transcription = { id: requestId, status: 'completed', model: 'stt-async-v5' }
const transcript = { id: requestId, text: 'Hello.', tokens: [] }

function run(status: 'completed' | 'error' = 'completed') {
  const engine = new InngestTestEngine({ function: handleSonioxCallback })
  return engine.execute({
    events: [{ name: 'soniox/callback', data: { transcriptId, jobId, requestId, status } }],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadState.mockResolvedValue({ state: 'fresh' })
  mockRecord.mockResolvedValue({ outcome: 'processed', attemptId: 'attempt-1' })
  mockConfirm.mockResolvedValue(true)
  mockPersistFailure.mockResolvedValue('job')
  mockFetchTranscription.mockResolvedValue({ raw: transcription, transcription })
  mockFetchTranscript.mockResolvedValue({ raw: transcript, transcript })
  mockDelete.mockResolvedValue(undefined)
  mockInsert.mockResolvedValue({ error: null })
  mockSend.mockResolvedValue({ ids: ['evt'] })
})

describe('handleSonioxCallback', () => {
  test('a completed job: fetched, stored for the exact attempt, then deleted at Soniox', async () => {
    const { result } = await run()

    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'soniox',
      jobId,
      requestId,
      transcriptId,
      rawBody: JSON.stringify({ transcription, transcript }),
    }))
    expect(mockDelete).toHaveBeenCalledWith(requestId)
    expect(mockRecord.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
    expect(result).toEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('the handoff is confirmed on its receipt before Soniox\'s copy is deleted', async () => {
    await run()

    expect(mockConfirm).toHaveBeenCalledWith(expect.anything(), 'soniox', requestId, 'attempt-1')
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

  test('a failed job: only its metadata is read, the exact attempt failed, then deleted', async () => {
    mockFetchTranscription.mockResolvedValue({
      raw: {},
      transcription: { ...transcription, status: 'error', error_type: 'audio_error', error_message: 'Audio could not be decoded' },
    })

    await run('error')

    expect(mockFetchTranscript).not.toHaveBeenCalled()
    expect(mockPersistFailure).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'soniox',
      jobId,
      requestId,
      transcriptId,
      message: 'Transcription failed: Audio could not be decoded',
    }))
    expect(mockDelete).toHaveBeenCalledWith(requestId)
  })

  test('a late duplicate of a handled callback fetches nothing and deletes again harmlessly', async () => {
    mockReadState.mockResolvedValue({ state: 'handled' })

    await run()

    expect(mockFetchTranscription).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
  })

  test('a callback for a transcript deleted here deletes Soniox\'s copy', async () => {
    mockReadState.mockResolvedValue({ state: 'gone' })

    const { result } = await run()

    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(requestId)
    expect(result).toEqual(expect.objectContaining({ status: 'forgotten' }))
  })

  test('a stale callback fetches, writes and deletes nothing', async () => {
    mockReadState.mockResolvedValue({ state: 'stale' })

    await run()

    expect(mockFetchTranscription).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a callback before the request id is saved throws, so Inngest retries', async () => {
    mockReadState.mockResolvedValue({ state: 'not_ready' })

    const { error } = await run()

    expect(String((error as Error)?.message ?? error)).toContain('has not saved Soniox request')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a linked file whose hand-off failed resumes from our copy, without fetching from Soniox, and only then deletes', async () => {
    mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })
    mockDownload.mockResolvedValue('{"stored":true}')

    await run()

    expect(mockFetchTranscription).not.toHaveBeenCalled()
    expect(mockFetchTranscript).not.toHaveBeenCalled()
    expect(mockDownload).toHaveBeenCalledWith(expect.anything(), 'user/t/job.json.gz')
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ rawBody: '{"stored":true}' }))
    expect(mockRecord.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0])
  })

  test('storing that fails between storage, link and hand-off is retried and deletes nothing', async () => {
    mockRecord.mockRejectedValue(new Error('send failed'))

    const { error } = await run()

    expect(error).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('an attempt that changed after the check (the write found it stale) deletes nothing', async () => {
    mockRecord.mockResolvedValue({ outcome: 'stale' })

    const { result } = await run()

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

describe('onSonioxCallbackFailure', () => {
  const failure = (message = 'Soniox down') =>
    onSonioxCallbackFailure({
      event: { data: { event: { data: { transcriptId, jobId, requestId, status: 'completed' } } } },
      error: new Error(message),
    })

  test('before the hand-off it fails the exact job, and never deletes at Soniox', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: false, resultLinked: false, jobExists: true })

    await failure()

    expect(mockSend).toHaveBeenCalledWith({
      name: 'transcription/failed',
      data: { transcriptId, jobId, error: 'Soniox down', errorType: 'transcription_error' },
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('after the hand-off, a cleanup that kept failing is recorded, and the transcription is left alone', async () => {
    mockHandoffState.mockResolvedValue({ handedOff: true, resultLinked: true, jobExists: true })

    await failure('delete refused')

    expect(mockSend).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'soniox/cleanup_failure',
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
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event_name: 'soniox/handoff_unconfirmed', job_id: jobId }))
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('a state that cannot be read throws, so the failure handler retries instead of failing the job', async () => {
    mockHandoffState.mockRejectedValue(new Error('db down'))

    await expect(failure()).rejects.toThrow('db down')
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockFallback).not.toHaveBeenCalled()
  })
})
