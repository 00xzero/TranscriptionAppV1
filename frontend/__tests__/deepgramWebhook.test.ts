/** @jest-environment node */

jest.mock('@/core/transcription/transition', () => ({
  transitionJob: jest.fn(),
  forceJobError: jest.fn(async () => true),
}))

jest.mock('@/infra/supabase/transcription-results.server', () => ({
  uploadTranscriptionResult: jest.fn(async () => ({ bytes: 42 })),
  removeTranscriptionResult: jest.fn(async () => undefined),
  downloadTranscriptionResult: jest.fn(),
}))

import { POST } from '../app/api/webhooks/deepgram/route'
import { forceJobError } from '@/core/transcription/transition'
import {
  removeTranscriptionResult,
  uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'

jest.mock('@/infra/inngest/client', () => {
  const sendInngestEvent = jest.fn(async () => undefined)
  return {
    sendInngestEvent,
    inngest: {
      send: sendInngestEvent,
    },
  }
})

type SupabaseError = { code?: string; message: string } | null
type ReceiptTakeoverRow = { id: string }
type ReceiptState =
  | { status: 'completed' | 'processing' | 'failed'; attempt_id: string; claimed_at: string }
  | { status: 'completed' | 'processing' | 'failed' }
type ReceiptInsertResult = { error: SupabaseError }
type ReceiptUpdateResult = { data: ReceiptTakeoverRow[] | null; error: SupabaseError }
type ReceiptSingleResult = { data: ReceiptState | null; error: SupabaseError }

// jobs: lookups (exact, then fallback) and the link update.
const jobMaybeSingle = jest.fn()
const jobSelectChain: any = {
  eq: jest.fn(() => jobSelectChain),
  in: jest.fn(() => jobSelectChain),
  order: jest.fn(() => jobSelectChain),
  limit: jest.fn(() => jobSelectChain),
  maybeSingle: jobMaybeSingle,
}
const jobLinkMaybeSingle = jest.fn()
const jobUpdateEq = jest.fn((_column: string, _value: string) => ({
  select: () => ({ maybeSingle: jobLinkMaybeSingle }),
}))
const jobUpdateMock = jest.fn((_values: Record<string, unknown>) => ({ eq: jobUpdateEq }))

// transcripts: the owner lookup and the no-job error fallback.
const transcriptMaybeSingle = jest.fn()
const transcriptSelectChain: any = {
  eq: jest.fn(() => transcriptSelectChain),
  maybeSingle: transcriptMaybeSingle,
}
const transcriptUpdateEq = jest.fn(async (_column: string, _value: string) => ({ error: null }))
const transcriptUpdateMock = jest.fn((_values: Record<string, unknown>) => ({ eq: transcriptUpdateEq }))

const insertMock = jest.fn(async () => ({ error: null }))
const mockForceJobError = forceJobError as jest.MockedFunction<typeof forceJobError>
const mockUpload = uploadTranscriptionResult as jest.MockedFunction<typeof uploadTranscriptionResult>
const mockRemove = removeTranscriptionResult as jest.MockedFunction<typeof removeTranscriptionResult>

// Thenable chain for receipt updates — supports .eq()/.neq()/.select() chaining;
// the chain itself is awaitable and delegates to receiptUpdateTerminal
const receiptUpdateTerminal = jest.fn(
  async (): Promise<ReceiptUpdateResult> => ({ data: null, error: null })
)
const receiptUpdateChain: any = {
  eq:     jest.fn(() => receiptUpdateChain),
  neq:    jest.fn(() => receiptUpdateChain),
  select: jest.fn(() => receiptUpdateChain),
  then:   (resolve: any, reject: any) => receiptUpdateTerminal().then(resolve, reject),
}
const receiptUpdateMock = jest.fn(
  (_values: Record<string, unknown>) => receiptUpdateChain
)

const receiptInsertMock = jest.fn(
  async (): Promise<ReceiptInsertResult> => ({ error: null })
)

const receiptSingleMock = jest.fn(
  async (): Promise<ReceiptSingleResult> => ({ data: null, error: null })
)
const receiptSelectChain: any = {
  eq:     jest.fn(() => receiptSelectChain),
  single: receiptSingleMock,
}
const receiptSelectMock = jest.fn(() => receiptSelectChain)

jest.mock('@/infra/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table === 'webhook_receipts') {
          return {
            insert: receiptInsertMock,
            update: receiptUpdateMock,
            select: receiptSelectMock,
          }
        }
        if (table === 'failed_events') {
          return { insert: insertMock }
        }
        if (table === 'transcripts') {
          return {
            select: () => transcriptSelectChain,
            update: transcriptUpdateMock,
          }
        }
        return {
          select: () => jobSelectChain,
          update: jobUpdateMock,
        }
      },
    }),
  }
})

const VALID_TRANSCRIPT_ID = '00000000-0000-0000-0000-000000000456'
const USER_ID = '00000000-0000-0000-0000-000000000789'
const RESULT_KEY = `${USER_ID}/${VALID_TRANSCRIPT_ID}/job-1.json.gz`

function requestWithBody(body: unknown, headers = new Headers({ 'dg-token': 'test-token' })) {
  const text = JSON.stringify(body)
  return { headers, text: async () => text } as any
}

function makeBody(requestId: string, transcriptId: string) {
  return {
    metadata: { request_id: requestId, extra: { transcript_id: transcriptId } },
    results: { channels: [] },
  }
}

function makeRequest(requestId: string, transcriptId: string) {
  return requestWithBody(makeBody(requestId, transcriptId))
}

/** Exact lookup misses, the fallback finds job-1. */
function findJobByFallback() {
  jobMaybeSingle
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })
}

describe('Deepgram webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jobMaybeSingle.mockReset()
    jobLinkMaybeSingle.mockReset()
    jobLinkMaybeSingle.mockResolvedValue({ data: { id: 'job-1' }, error: null })
    transcriptMaybeSingle.mockReset()
    transcriptMaybeSingle.mockResolvedValue({ data: { user_id: USER_ID }, error: null })
    mockUpload.mockReset()
    mockUpload.mockResolvedValue({ bytes: 42 })
    process.env.DEEPGRAM_API_KEY_IDENTIFIER = 'test-token'

    receiptInsertMock.mockReset()
    receiptInsertMock.mockResolvedValue({ error: null })
    receiptUpdateTerminal.mockReset()
    receiptUpdateTerminal.mockResolvedValue({ data: null, error: null })
    receiptSingleMock.mockReset()
  })

  test('stores the body exactly as sent, links it, and sends a minimal Inngest event', async () => {
    findJobByFallback()

    // Fields our schema does not list must survive into the stored file.
    const body = { ...makeBody('req-123', VALID_TRANSCRIPT_ID), model_info: { arch: 'nova-3' } }
    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      text: async () => JSON.stringify(body, null, 2),
    } as any

    const res = await POST(request)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // The receipt is claimed and finalised under the engine the route names.
    expect(receiptInsertMock).toHaveBeenCalledWith(expect.objectContaining({ provider: 'deepgram', request_id: 'req-123' }))
    expect(receiptUpdateChain.eq).toHaveBeenCalledWith('provider', 'deepgram')

    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(mockUpload).toHaveBeenCalledWith(
      expect.anything(),
      RESULT_KEY,
      JSON.stringify(body, null, 2)
    )

    expect(jobUpdateMock).toHaveBeenCalledTimes(1)
    expect(jobUpdateMock).toHaveBeenCalledWith({
      result_object_key: RESULT_KEY,
      inngest_event_id: 'req-123',
    })
    expect(jobUpdateEq).toHaveBeenCalledWith('id', 'job-1')
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(jobUpdateMock.mock.invocationCallOrder[0])

    const { sendInngestEvent } = await import('@/infra/inngest/client')
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect((sendInngestEvent as jest.Mock).mock.calls[0][0]).toEqual({
      name: 'transcription/webhook',
      data: {
        requestId: 'req-123',
        transcriptId: VALID_TRANSCRIPT_ID,
      },
    })
  })

  test('rejects when dg-token is missing', async () => {
    const res = await POST(requestWithBody({}, new Headers({})))
    expect(res.status).toBe(401)

    const { sendInngestEvent } = await import('@/infra/inngest/client')
    expect(sendInngestEvent).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(jobUpdateMock).not.toHaveBeenCalled()
  })

  test('calls forceJobError when transcript_id missing but job found via requestId', async () => {
    jobMaybeSingle.mockResolvedValueOnce({
      data: { id: 'job-1', transcript_id: VALID_TRANSCRIPT_ID },
      error: null,
    })

    const res = await POST(requestWithBody({
      metadata: { request_id: 'req-123', extra: {} },
      results: { channels: [] },
    }))
    expect(res.status).toBe(400)

    expect(mockForceJobError).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        context: 'persistWebhookFailure',
        extraJobFields: expect.objectContaining({
          error_message: 'Deepgram webhook missing transcript_id or request_id.',
          error_type: 'transcription_error',
        }),
      })
    )
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('marks transcript as error and logs failed_event when transcript is known but no job is found', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(requestWithBody({
      metadata: { extra: { transcript_id: VALID_TRANSCRIPT_ID } },
      results: { channels: [] },
    }))
    expect(res.status).toBe(400)

    expect(insertMock).toHaveBeenCalledWith({
      event_name: 'deepgram/webhook_failure',
      event_data: { transcriptId: VALID_TRANSCRIPT_ID, requestId: undefined },
      error_message: 'Deepgram webhook missing transcript_id or request_id.',
      transcript_id: VALID_TRANSCRIPT_ID,
    })
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(transcriptUpdateEq).toHaveBeenCalledWith('id', VALID_TRANSCRIPT_ID)
    expect(mockForceJobError).not.toHaveBeenCalled()
  })

  // --- Deepgram error callback ---
  // Captured from a corrupt-audio run: top-level fields only, no metadata.
  const ERROR_CALLBACK = {
    err_code: 'Bad Request',
    err_msg: 'Bad Request: failed to process audio: corrupt or unsupported data',
    request_id: 'req-failed',
  }

  test('fails the job named by the error callback request id with Deepgram\'s message', async () => {
    jobMaybeSingle.mockResolvedValueOnce({
      data: { id: 'job-1', transcript_id: VALID_TRANSCRIPT_ID },
      error: null,
    })

    const res = await POST(requestWithBody(ERROR_CALLBACK))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(jobSelectChain.eq).toHaveBeenCalledWith('inngest_event_id', 'req-failed')
    expect(mockForceJobError).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        context: 'persistWebhookFailure',
        extraJobFields: expect.objectContaining({
          error_message: 'Transcription failed: Bad Request: failed to process audio: corrupt or unsupported data',
          error_type: 'transcription_error',
        }),
      })
    )
    const detail = mockForceJobError.mock.calls[0][0].extraJobFields?.error_detail
    expect(JSON.parse(detail ?? '')).toEqual(ERROR_CALLBACK)
    expect(receiptInsertMock).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    const { sendInngestEvent } = await import('@/infra/inngest/client')
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('asks Deepgram to retry an error callback that arrives before its job has the request id', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(requestWithBody(ERROR_CALLBACK))

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockForceJobError).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
    expect(transcriptUpdateMock).not.toHaveBeenCalled()
  })

  test('asks Deepgram to retry when failing the job does not go through', async () => {
    jobMaybeSingle.mockResolvedValueOnce({
      data: { id: 'job-1', transcript_id: VALID_TRANSCRIPT_ID },
      error: null,
    })
    mockForceJobError.mockResolvedValueOnce(false)

    const res = await POST(requestWithBody(ERROR_CALLBACK))

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockForceJobError).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1' }))
  })

  test('an error callback without a request id names no job and is refused', async () => {
    const { request_id: _requestId, ...withoutRequestId } = ERROR_CALLBACK

    const res = await POST(requestWithBody(withoutRequestId))

    expect(res.status).toBe(400)
    expect(jobMaybeSingle).not.toHaveBeenCalled()
    expect(mockForceJobError).not.toHaveBeenCalled()
  })

  // --- Storing the response ---

  test('marks receipt failed and stores nothing on the job when the upload fails', async () => {
    findJobByFallback()
    mockUpload.mockRejectedValueOnce(new Error('Failed to store Deepgram response: storage down'))

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    expect(receiptUpdateMock.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' })
    const { sendInngestEvent } = await import('@/infra/inngest/client')
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('removes the stored file when the job is deleted during the upload', async () => {
    findJobByFallback()
    jobLinkMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), RESULT_KEY, 'webhook')
    expect(receiptUpdateMock.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' })
    const { sendInngestEvent } = await import('@/infra/inngest/client')
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('keeps the stored file when the link update errors, so a retry can overwrite it', async () => {
    findJobByFallback()
    jobLinkMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(mockRemove).not.toHaveBeenCalled()
    expect(receiptUpdateMock.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' })
  })

  test('treats a missing transcript like a missing job', async () => {
    findJobByFallback()
    transcriptMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // persistWebhookFailure looks the active job up again to fail it.
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockForceJobError).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1' }))
    expect(receiptUpdateMock.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'failed' })
  })

  test('a retry after a failed event send overwrites the same file and sends the event', async () => {
    const { inngest } = await import('@/infra/inngest/client')

    // First delivery: stored and linked, but the event send fails.
    ;(inngest.send as jest.Mock).mockRejectedValueOnce(new Error('Inngest timeout'))
    findJobByFallback()
    expect((await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))).status).toBe(500)

    // Redelivery takes over the failed receipt.
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'failed', attempt_id: 'first-attempt', claimed_at: new Date().toISOString() },
      error: null,
    })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null }) // takeover wins
      .mockResolvedValueOnce({ data: null, error: null })             // finalize success
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })
    expect((await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))).status).toBe(200)

    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls.map((call) => call[1])).toEqual([RESULT_KEY, RESULT_KEY])
    expect(jobUpdateMock.mock.calls.map((call) => call[0].result_object_key)).toEqual([RESULT_KEY, RESULT_KEY])
    expect(inngest.send).toHaveBeenCalledTimes(2)
    expect(mockRemove).not.toHaveBeenCalled()
  })

  // --- Idempotency guard tests ---

  test('returns 200 no-op when receipt is completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'completed', attempt_id: 'old-id', claimed_at: new Date().toISOString() },
      error: null,
    })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(200)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 503 when receipt is processing and fresh', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'processing', attempt_id: 'owner-id', claimed_at: new Date().toISOString() },
      error: null,
    })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(503)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('takes over and processes when receipt is processing but stale', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      // claimed_at is 6 minutes ago — past the 5-minute RECEIPT_LEASE_MS
      data: { status: 'processing', attempt_id: 'stale-id', claimed_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
      error: null,
    })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null }) // takeover wins
      .mockResolvedValueOnce({ data: null, error: null })             // finalize success
    findJobByFallback()

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(200)
    expect(jobUpdateMock).toHaveBeenCalledTimes(1)
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).toHaveBeenCalledTimes(1)
  })

  test('returns 500 when receipt status read fails', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('takes over and processes when receipt is failed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
      error: null,
    })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null }) // takeover wins
      .mockResolvedValueOnce({ data: null, error: null })             // finalize success
    findJobByFallback()

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(200)
    expect(jobUpdateMock).toHaveBeenCalledTimes(1) // job link
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).toHaveBeenCalledTimes(1)
  })

  test('returns 500 when takeover update errors', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
      error: null,
    })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 503 when takeover loses and re-read is not completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock
      .mockResolvedValueOnce({
        data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
        error: null,
      })
      // Re-read after 0 rows: still processing (race winner not done yet)
      .mockResolvedValueOnce({ data: { status: 'processing' }, error: null })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(503)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 200 when takeover loses but re-read shows completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock
      .mockResolvedValueOnce({
        data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
        error: null,
      })
      // Re-read after 0 rows: race winner already finished
      .mockResolvedValueOnce({ data: { status: 'completed' }, error: null })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(200)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('marks receipt failed (scoped by attempt_id) when downstream work throws', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: null })
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'DB timeout' } })

    const res = await POST(makeRequest('req-fail', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    expect(receiptUpdateTerminal).toHaveBeenCalled()
    const lastUpdateArgs = receiptUpdateMock.mock.calls.at(-1)
    expect(lastUpdateArgs?.[0]).toMatchObject({ status: 'failed' })
  })

  test('returns 200 and leaves receipt processing when finalize update fails', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: null })
    findJobByFallback()
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: null, error: { message: 'finalize failed' } }) // finalize fails

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    // Real work was done — still return 200
    expect(res.status).toBe(200)
    // Only the failed finalize attempt — no mark-failed call
    expect(receiptUpdateTerminal).toHaveBeenCalledTimes(1)
  })

  test('returns 503 when receipt insert fails with non-conflict error', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } })

    const res = await POST(makeRequest('req-123', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(503)
    expect(jobUpdateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 400 for structurally invalid payload (non-object)', async () => {
    const res = await POST(requestWithBody('not an object at all'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid payload structure')

    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
    expect(jobUpdateMock).not.toHaveBeenCalled()
  })

  test('returns 400 for a body that is not JSON, so Deepgram does not retry it', async () => {
    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      text: async () => '{not json',
    } as any

    const res = await POST(request)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid payload structure')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(receiptInsertMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 500 when the body cannot be read, so Deepgram retries', async () => {
    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      text: async () => { throw new Error('connection reset') },
    } as any

    const res = await POST(request)
    expect(res.status).toBe(500)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('marks receipt failed when inngest.send throws after receipt claim', async () => {
    const { inngest } = await import('@/infra/inngest/client')
    ;(inngest.send as jest.Mock).mockRejectedValueOnce(new Error('Inngest timeout'))

    receiptInsertMock.mockResolvedValueOnce({ error: null })
    findJobByFallback()

    const res = await POST(makeRequest('req-inngest-fail', VALID_TRANSCRIPT_ID))

    expect(res.status).toBe(500)
    // Receipt must be marked failed so retries can take over immediately
    const lastUpdateArg = receiptUpdateMock.mock.calls.at(-1)?.[0]
    expect(lastUpdateArg).toMatchObject({ status: 'failed' })
  })

  test('returns 400 and uses extracted identifiers to fail job when schema fails but metadata is recoverable', async () => {
    // Payload has valid request_id but transcript_id is not a UUID — fails schema,
    // but persistWebhookFailure should still receive the partial identifiers
    jobMaybeSingle.mockResolvedValueOnce({
      data: { id: 'job-1', transcript_id: VALID_TRANSCRIPT_ID },
      error: null,
    })

    const res = await POST(requestWithBody({
      metadata: {
        request_id: 'req-recoverable',
        extra: { transcript_id: 'not-a-uuid' },
      },
    }))
    expect(res.status).toBe(400)

    // forceJobError should have been called via persistWebhookFailure using the recovered requestId
    expect(mockForceJobError).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', context: 'persistWebhookFailure' })
    )

    const { inngest } = await import('@/infra/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })
})
