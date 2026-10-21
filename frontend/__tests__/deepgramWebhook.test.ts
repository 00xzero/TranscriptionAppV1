/** @jest-environment node */

/**
 * The Deepgram webhook route: it stores the result for its exact job attempt
 * and passes it to Inngest, holding no receipt, so a request cut off anywhere
 * is simply redone by Deepgram's retry. The handoff itself is tested in
 * deepgramCallbackHandler.test.ts.
 */

jest.mock('@/core/transcription/transition', () => ({
  transitionJob: jest.fn(),
  forceJobError: jest.fn(async () => true),
}))

jest.mock('@/infra/supabase/transcription-results.server', () => ({
  uploadTranscriptionResult: jest.fn(async () => ({ bytes: 42 })),
  removeTranscriptionResult: jest.fn(async () => undefined),
  downloadTranscriptionResult: jest.fn(),
}))

jest.mock('@/infra/inngest/client', () => {
  const sendInngestEvent = jest.fn(async () => undefined)
  return { sendInngestEvent, inngest: { send: sendInngestEvent } }
})

import { POST } from '../app/api/webhooks/deepgram/route'
import { forceJobError } from '@/core/transcription/transition'
import { sendInngestEvent } from '@/infra/inngest/client'
import {
  removeTranscriptionResult,
  uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'

type Row = Record<string, unknown> | null
type Read = { data: Row; error: { message: string } | null }

// jobs: the staging reads (by id) and, for a failure, the lookup by request id.
const jobMaybeSingle = jest.fn<Promise<Read>, []>()
const jobSelectChain: any = {
  eq: jest.fn(() => jobSelectChain),
  in: jest.fn(() => jobSelectChain),
  order: jest.fn(() => jobSelectChain),
  limit: jest.fn(() => jobSelectChain),
  maybeSingle: jobMaybeSingle,
}
const jobUpdateMock = jest.fn()

// transcripts: the staging reads, and the error fallback for a known transcript.
const transcriptMaybeSingle = jest.fn<Promise<Read>, []>()
const transcriptSelectChain: any = {
  eq: jest.fn(() => transcriptSelectChain),
  maybeSingle: transcriptMaybeSingle,
}
const transcriptUpdateEq = jest.fn(async (_column: string, _value: string) => ({ error: null }))
const transcriptUpdateMock = jest.fn((_values: Record<string, unknown>) => ({ eq: transcriptUpdateEq }))

const failedEventsInsert = jest.fn(async () => ({ error: null }))
const receiptsTouched = jest.fn()

jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'webhook_receipts') {
        receiptsTouched()
        return {}
      }
      if (table === 'failed_events') return { insert: failedEventsInsert }
      if (table === 'transcripts') return { select: () => transcriptSelectChain, update: transcriptUpdateMock }
      return { select: () => jobSelectChain, update: jobUpdateMock }
    },
  }),
}))

const mockForceJobError = forceJobError as jest.MockedFunction<typeof forceJobError>
const mockUpload = uploadTranscriptionResult as jest.MockedFunction<typeof uploadTranscriptionResult>
const mockRemove = removeTranscriptionResult as jest.MockedFunction<typeof removeTranscriptionResult>
const mockSend = sendInngestEvent as unknown as jest.Mock

const TRANSCRIPT_ID = '00000000-0000-4000-8000-000000000456'
const USER_ID = '00000000-0000-4000-8000-000000000789'
const JOB_ID = '00000000-0000-4000-8000-0000000000a1'
const REQUEST_ID = 'req-123'
const RESULT_KEY = `${USER_ID}/${TRANSCRIPT_ID}/${JOB_ID}.json.gz`

function requestWithText(text: string, headers = new Headers({ 'dg-token': 'test-token' })) {
  return { headers, text: async () => text } as any
}

function requestWithBody(body: unknown, headers?: Headers) {
  return requestWithText(JSON.stringify(body), headers)
}

function makeBody(extra: Record<string, unknown> = {}) {
  return {
    metadata: {
      request_id: REQUEST_ID,
      extra: { transcript_id: TRANSCRIPT_ID, job_id: JOB_ID, user_id: USER_ID, ...extra },
    },
    results: { channels: [] },
  }
}

const transcriptRow = { data: { user_id: USER_ID }, error: null }
const noRow = { data: null, error: null }
const jobRow = (job: Record<string, unknown> = {}) => ({
  data: { transcript_id: TRANSCRIPT_ID, status: 'processing', inngest_event_id: REQUEST_ID, ...job },
  error: null,
})

/** The staging reads: once before the upload, once after. */
function reads(before: [Read, Read], after?: [Read, Read]) {
  transcriptMaybeSingle.mockResolvedValueOnce(before[0])
  jobMaybeSingle.mockResolvedValueOnce(before[1])
  if (after) {
    transcriptMaybeSingle.mockResolvedValueOnce(after[0])
    jobMaybeSingle.mockResolvedValueOnce(after[1])
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jobMaybeSingle.mockReset()
  transcriptMaybeSingle.mockReset()
  mockUpload.mockReset()
  mockUpload.mockResolvedValue({ bytes: 42 })
  mockRemove.mockReset()
  mockRemove.mockResolvedValue(undefined)
  mockSend.mockReset()
  mockSend.mockResolvedValue(undefined)
  process.env.DEEPGRAM_API_KEY_IDENTIFIER = 'test-token'
})

describe('Deepgram webhook route: storing and passing on', () => {
  test('stores the body exactly as sent at the job\'s own key, then passes it on, holding no receipt', async () => {
    reads([transcriptRow, jobRow()], [transcriptRow, jobRow()])
    // Fields our schema does not list must survive into the stored file.
    const text = JSON.stringify({ ...makeBody(), model_info: { arch: 'nova-3' } }, null, 2)

    const res = await POST(requestWithText(text))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(mockUpload).toHaveBeenCalledWith(expect.anything(), RESULT_KEY, text)
    expect(mockSend).toHaveBeenCalledWith({
      name: 'deepgram/callback',
      id: `deepgram-callback:${REQUEST_ID}`,
      data: { transcriptId: TRANSCRIPT_ID, jobId: JOB_ID, requestId: REQUEST_ID, userId: USER_ID },
    })
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(mockSend.mock.invocationCallOrder[0])
    // Linking and the receipt are the Inngest function's.
    expect(jobUpdateMock).not.toHaveBeenCalled()
    expect(receiptsTouched).not.toHaveBeenCalled()
  })

  test.each([
    ['still queued', { status: 'queued', inngest_event_id: null }],
    ['processing without the request id saved yet', { inngest_event_id: null }],
  ])('a job %s: 503 to retry, and nothing is written (another start\'s result must not land on it)', async (_label, job) => {
    reads([transcriptRow, jobRow(job)])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test.each([
    ['carries another request', { inngest_event_id: 'req-other' }],
    ['belongs to another transcript', { transcript_id: '00000000-0000-4000-8000-000000000999' }],
    ['has failed', { status: 'error' }],
    ['has completed', { status: 'completed' }],
  ])('a job that %s: 200 and nothing is written', async (_label, job) => {
    reads([transcriptRow, jobRow(job)])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(200)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a callback whose user id is not the transcript\'s owner writes nothing', async () => {
    reads([{ data: { user_id: '00000000-0000-4000-8000-000000000111' }, error: null }, jobRow()])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(200)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('a deleted transcript: 200, and any file an earlier delivery left at the job\'s key is removed', async () => {
    reads([noRow, noRow])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(200)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), RESULT_KEY, expect.any(String))
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a removal that fails is a 500, so Deepgram retries it', async () => {
    reads([noRow, noRow])
    mockRemove.mockRejectedValueOnce(new Error('storage down'))

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(500)
  })

  test('a transcript deleted during the upload: the file is removed and nothing is passed on', async () => {
    reads([transcriptRow, jobRow()], [noRow, noRow])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), RESULT_KEY, expect.any(String))
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(mockRemove.mock.invocationCallOrder[0])
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a job that failed during the upload keeps the file in its own folder and passes nothing on', async () => {
    reads([transcriptRow, jobRow()], [transcriptRow, jobRow({ status: 'error' })])

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(200)
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('an upload that fails is a 500 and passes nothing on', async () => {
    reads([transcriptRow, jobRow()])
    mockUpload.mockRejectedValueOnce(new Error('storage down'))

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(500)
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a send that fails is a 500; the retry overwrites the same file and sends the same event', async () => {
    reads([transcriptRow, jobRow()], [transcriptRow, jobRow()])
    mockSend.mockRejectedValueOnce(new Error('Inngest down'))

    expect((await POST(requestWithBody(makeBody()))).status).toBe(500)

    reads([transcriptRow, jobRow()], [transcriptRow, jobRow()])
    expect((await POST(requestWithBody(makeBody()))).status).toBe(200)

    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls[0][1]).toBe(RESULT_KEY)
    expect(mockUpload.mock.calls[1][1]).toBe(RESULT_KEY)
    expect(mockSend.mock.calls[0][0].id).toBe(mockSend.mock.calls[1][0].id)
  })

  test('a job that cannot be read is a 500, writing nothing', async () => {
    transcriptMaybeSingle.mockResolvedValueOnce(transcriptRow)
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })

    const res = await POST(requestWithBody(makeBody()))

    expect(res.status).toBe(500)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('a callback without a job id (a job started before it was sent) is refused, failing the transcript\'s active job', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })

    const res = await POST(requestWithBody(makeBody({ job_id: undefined })))

    expect(res.status).toBe(400)
    expect(jobSelectChain.eq).toHaveBeenCalledWith('transcript_id', TRANSCRIPT_ID)
    expect(mockForceJobError).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', context: 'persistWebhookFailure' }))
    expect(mockUpload).not.toHaveBeenCalled()
  })
})

describe('Deepgram webhook route: checks before anything is stored', () => {
  test('rejects when dg-token is missing', async () => {
    const res = await POST(requestWithBody({}, new Headers({})))
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('calls forceJobError when transcript_id missing but job found via requestId', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1', transcript_id: TRANSCRIPT_ID }, error: null })

    const res = await POST(requestWithBody({ metadata: { request_id: REQUEST_ID, extra: {} }, results: { channels: [] } }))
    expect(res.status).toBe(400)

    expect(mockForceJobError).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        context: 'persistWebhookFailure',
        extraJobFields: expect.objectContaining({
          error_message: 'Deepgram webhook missing its transcript, job or request id.',
          error_type: 'transcription_error',
        }),
      })
    )
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('marks transcript as error and logs failed_event when transcript is known but no job is found', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(requestWithBody({ metadata: { extra: { transcript_id: TRANSCRIPT_ID } }, results: { channels: [] } }))
    expect(res.status).toBe(400)

    expect(failedEventsInsert).toHaveBeenCalledWith({
      event_name: 'deepgram/webhook_failure',
      event_data: { transcriptId: TRANSCRIPT_ID, requestId: undefined },
      error_message: 'Deepgram webhook missing its transcript, job or request id.',
      transcript_id: TRANSCRIPT_ID,
    })
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(transcriptUpdateEq).toHaveBeenCalledWith('id', TRANSCRIPT_ID)
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
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1', transcript_id: TRANSCRIPT_ID }, error: null })

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
    expect(receiptsTouched).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('asks Deepgram to retry an error callback that arrives before its job has the request id', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const res = await POST(requestWithBody(ERROR_CALLBACK))

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockForceJobError).not.toHaveBeenCalled()
    expect(failedEventsInsert).not.toHaveBeenCalled()
    expect(transcriptUpdateMock).not.toHaveBeenCalled()
  })

  test('asks Deepgram to retry when failing the job does not go through', async () => {
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1', transcript_id: TRANSCRIPT_ID }, error: null })
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

  test('returns 400 for structurally invalid payload (non-object)', async () => {
    const res = await POST(requestWithBody('not an object at all'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid payload structure')
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('returns 400 for a body that is not JSON, so Deepgram does not retry it', async () => {
    const res = await POST(requestWithText('{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid payload structure')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
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

  test('returns 400 and uses extracted identifiers to fail job when schema fails but metadata is recoverable', async () => {
    // Payload has a valid request_id but a transcript_id that is not a UUID: it
    // fails the schema, but persistWebhookFailure still gets the request id.
    jobMaybeSingle.mockResolvedValueOnce({ data: { id: 'job-1', transcript_id: TRANSCRIPT_ID }, error: null })

    const res = await POST(requestWithBody({ metadata: { request_id: 'req-recoverable', extra: { transcript_id: 'not-a-uuid' } } }))
    expect(res.status).toBe(400)
    expect(mockForceJobError).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', context: 'persistWebhookFailure' }))
    expect(mockSend).not.toHaveBeenCalled()
  })
})
