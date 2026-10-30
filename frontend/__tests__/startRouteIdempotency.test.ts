/** @jest-environment node */

const getCurrentUserMock = jest.fn()
const fromMock = jest.fn()
const adminFromMock = jest.fn()

jest.mock('@/infra/supabase/storage', () => {
  return {
    getMediaUrlForEngine: jest.fn(),
  }
})

jest.mock('@/lib/auth/current-user.server', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

jest.mock('@/infra/supabase/server', () => {
  return {
    createClient: () => ({
      [Symbol.asyncDispose]: async () => {},
      from: fromMock,
    }),
  }
})

// Jobs are server-owned, so the start flow writes them through the admin client.
jest.mock('@/infra/supabase/admin', () => {
  return {
    createAdminClient: () => ({ from: adminFromMock }),
  }
})

jest.mock('@/infra/inngest/client', () => {
  const sendInngestEvent = jest.fn(async () => undefined)
  return {
    sendInngestEvent,
    inngest: {
      send: sendInngestEvent,
    },
  }
})

import { POST } from '../app/api/transcripts/[id]/start/route'
import { sendInngestEvent } from '@/infra/inngest/client'
import { getMediaUrlForEngine } from '@/infra/supabase/storage'
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '@/contracts/transcription-options'
import { EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

// The transcript columns as the database returns them.
const STORED_OPTIONS = { ...DEFAULT_TRANSCRIPTION_OPTIONS }

const transcriptSingleMock = jest.fn()
const transcriptEqMock = jest.fn(() => ({ single: transcriptSingleMock }))
const transcriptSelectMock = jest.fn(() => ({ eq: transcriptEqMock }))
const transcriptUpdateEqMock = jest.fn()
const transcriptUpdateMock = jest.fn(() => ({ eq: transcriptUpdateEqMock }))

const jobsMaybeSingleMock = jest.fn()
const jobsEqMock = jest.fn()
const jobsSelectChain = {
  eq: jobsEqMock,
  maybeSingle: jobsMaybeSingleMock,
}
const jobsSelectMock = jest.fn(() => jobsSelectChain)
const jobsInsertSingleMock = jest.fn()
const jobsInsertSelectMock = jest.fn(() => ({ single: jobsInsertSingleMock }))
const jobsInsertMock = jest.fn(() => ({ select: jobsInsertSelectMock }))

const watchlistEqMock = jest.fn()
const watchlistSelectMock = jest.fn(() => ({ eq: watchlistEqMock }))

describe('Start route idempotency', () => {
  const originalRateLimitMode = process.env.RATE_LIMIT_MODE

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.RATE_LIMIT_MODE = 'off'

    transcriptSingleMock.mockReset()
    transcriptEqMock.mockClear()
    transcriptSelectMock.mockClear()
    transcriptUpdateEqMock.mockReset()
    transcriptUpdateMock.mockClear()
    jobsMaybeSingleMock.mockReset()
    jobsEqMock.mockClear()
    jobsSelectMock.mockClear()
    jobsInsertSingleMock.mockReset()
    jobsInsertSelectMock.mockClear()
    jobsInsertMock.mockClear()
    watchlistEqMock.mockReset()
    watchlistSelectMock.mockClear()

    jobsEqMock.mockImplementation(() => jobsSelectChain)
    transcriptUpdateEqMock.mockResolvedValue({ error: null })
    jobsInsertSingleMock.mockResolvedValue({ data: { id: 'job-new' }, error: null })
    watchlistEqMock.mockResolvedValue({ data: [], error: null })
    ;(getMediaUrlForEngine as jest.Mock).mockResolvedValue({
      url: 'https://example.com/media.mp3',
      error: null,
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'transcripts') {
        return { select: transcriptSelectMock, update: transcriptUpdateMock }
      }
      if (table === 'jobs') {
        return { select: jobsSelectMock }
      }
      if (table === 'watchlist') {
        return { select: watchlistSelectMock }
      }
      return {}
    })

    adminFromMock.mockImplementation((table: string) => {
      if (table === 'jobs') return { insert: jobsInsertMock }
      return {}
    })

    getCurrentUserMock.mockResolvedValue({ id: 'user-1', email: '' })
  })

  afterEach(() => {
    process.env.RATE_LIMIT_MODE = originalRateLimitMode
  })

  test.each([null, '', 'original-user'])('an absent or different owner cannot start a job (%s)', async (expected) => {
    const response = await POST(
      { headers: new Headers(expected === null ? {} : { [EXPECTED_USER_HEADER]: expected }) } as never,
      { params: Promise.resolve({ id: 'proj-1' }) }
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(fromMock).not.toHaveBeenCalled()
    expect(adminFromMock).not.toHaveBeenCalled()
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('a signed-out request remains unauthorized before the account check', async () => {
    getCurrentUserMock.mockResolvedValue(null)
    const response = await POST({ headers: new Headers() } as never, { params: Promise.resolve({ id: 'proj-1' }) })
    expect(response.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
    expect(adminFromMock).not.toHaveBeenCalled()
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('returns cached job when transcript is queued and idempotency key matches', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'queued', ...STORED_OPTIONS },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: { id: 'job-1', status: 'queued' },
      error: null,
    })

    const request = {
      headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-1' }),
    } as any

    const res = await POST(
      request,
      { params: Promise.resolve({ id: 'proj-1' }) } as any
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      message: 'Transcription started',
      jobId: 'job-1',
      cached: true,
    })
  })

  test('returns conflict when cached job is in error state', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-err', source_object_key: 'source-err', status: 'error', ...STORED_OPTIONS },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: { id: 'job-err', status: 'error' },
      error: null,
    })

    const request = {
      headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-error-state' }),
    } as any

    const res = await POST(
      request,
      { params: Promise.resolve({ id: 'proj-err' }) } as any
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json).toEqual({
      error: 'Previous transcription attempt failed. Please retry with a new idempotency key.',
      jobId: 'job-err',
      status: 'error',
    })
  })

  test.each(['new-key', null])('does not restart a completed transcript with key %s', async (key) => {
    transcriptSingleMock.mockResolvedValue({ data: { id: 'done', source_object_key: 'media', status: 'completed', ...STORED_OPTIONS }, error: null })
    jobsMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    const res = await POST({ headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', ...(key ? { 'x-idempotency-key': key } : {}) }) } as any,
      { params: Promise.resolve({ id: 'done' }) } as any)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This transcript is already completed.' })
    expect(jobsInsertMock).not.toHaveBeenCalled()
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('a completed transcript still replays its original completed job', async () => {
    transcriptSingleMock.mockResolvedValue({ data: { id: 'done', source_object_key: 'media', status: 'completed', ...STORED_OPTIONS }, error: null })
    jobsMaybeSingleMock.mockResolvedValue({ data: { id: 'original', status: 'completed' }, error: null })
    const res = await POST({ headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'original-key' }) } as any,
      { params: Promise.resolve({ id: 'done' }) } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobId: 'original', cached: true })
    expect(jobsInsertMock).not.toHaveBeenCalled()
  })

  test('completion between the initial read and job insertion is refused by the database guard', async () => {
    transcriptSingleMock.mockResolvedValue({ data: { id: 'done', source_object_key: 'media', status: 'error', ...STORED_OPTIONS }, error: null })
    jobsMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    jobsInsertSingleMock.mockResolvedValue({ data: null, error: { code: 'SP004' } })
    const res = await POST({ headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'new-key' }) } as any,
      { params: Promise.resolve({ id: 'done' }) } as any)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This transcript is already completed.' })
  })

  test('a completion race still returns the original job for the same idempotency key', async () => {
    transcriptSingleMock.mockResolvedValue({ data: { id: 'done', source_object_key: 'media', status: 'error', ...STORED_OPTIONS }, error: null })
    jobsMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'original', status: 'completed' }, error: null })
    jobsInsertSingleMock.mockResolvedValue({ data: null, error: { code: 'SP004' } })
    const res = await POST({ headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'original-key' }) } as any,
      { params: Promise.resolve({ id: 'done' }) } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobId: 'original', cached: true })
  })

  test('creates a new job when no cached job exists', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'created', ...STORED_OPTIONS },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: null,
      error: null,
    })

    const request = {
      headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-new' }),
    } as any

    const res = await POST(
      request,
      { params: Promise.resolve({ id: 'proj-1' }) } as any
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      message: 'Transcription started',
      jobId: 'job-new',
    })
    expect(jobsInsertMock).toHaveBeenCalledTimes(1)
    const [insertPayload] = jobsInsertMock.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(insertPayload).toMatchObject({
      transcript_id: 'proj-1',
      status: 'queued',
      type: 'transcription',
      idempotency_key: 'idem-new',
    })
  })

  test('hands a new job to media preparation, once per job', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'created', ...STORED_OPTIONS },
      error: null,
    })
    jobsMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    watchlistEqMock.mockResolvedValue({ data: [{ term: 'Dechra' }], error: null })

    const res = await POST(
      { headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-prepare' }) } as any,
      { params: Promise.resolve({ id: 'proj-1' }) } as any
    )

    expect(res.status).toBe(200)
    // Preparation asks for the transcription and the waveform itself, after
    // it has settled which file the transcript keeps.
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect(sendInngestEvent).toHaveBeenCalledWith({
      name: 'media/prepare-requested',
      data: {
        transcriptId: 'proj-1',
        jobId: 'job-new',
        userId: 'user-1',
        keyTerms: ['Dechra'],
        transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
      },
    })
    expect(adminFromMock).not.toHaveBeenCalledWith('transcripts')
  })

  test('a file Deepgram could not be handed refuses the start, creating no job', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'created', ...STORED_OPTIONS },
      error: null,
    })
    jobsMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    ;(getMediaUrlForEngine as jest.Mock).mockResolvedValue({
      url: null,
      error: 'Media proxy misconfigured: missing MEDIA_PROXY_SECRET',
    })

    const res = await POST(
      { headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-broken' }) } as any,
      { params: Promise.resolve({ id: 'proj-1' }) } as any
    )

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Media proxy misconfigured: missing MEDIA_PROXY_SECRET' })
    expect(jobsInsertMock).not.toHaveBeenCalled()
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  test('continues when idempotency lookup fails', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-2', source_object_key: 'source-2', status: 'created', ...STORED_OPTIONS },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'lookup failed' },
    })

    const request = {
      headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1', 'x-idempotency-key': 'idem-error' }),
    } as any

    const res = await POST(
      request,
      { params: Promise.resolve({ id: 'proj-2' }) } as any
    )

    expect(res.status).toBe(200)
    expect(jobsInsertMock).toHaveBeenCalledTimes(1)
  })

  test('creates a job without idempotency key when header is missing', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-3', source_object_key: 'source-3', status: 'created', ...STORED_OPTIONS },
      error: null,
    })

    const request = {
      headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1' }),
    } as any

    const res = await POST(
      request,
      { params: Promise.resolve({ id: 'proj-3' }) } as any
    )

    expect(res.status).toBe(200)
    expect(jobsSelectMock).not.toHaveBeenCalled()
    expect(jobsInsertMock).toHaveBeenCalledTimes(1)
    const [insertPayload] = jobsInsertMock.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(insertPayload).toMatchObject({
      transcript_id: 'proj-3',
      status: 'queued',
      type: 'transcription',
    })
    expect(insertPayload).not.toHaveProperty('idempotency_key')
  })

  test('sends the options stored on the transcript with the job', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: {
        id: 'proj-4',
        source_object_key: 'source-4',
        status: 'created',
        engine: 'deepgram',
        language: 'multi',
        detect_speakers: false,
        keep_filler_words: false,
        mask_profanity: true,
      },
      error: null,
    })

    const res = await POST(
      { headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1' }) } as any,
      { params: Promise.resolve({ id: 'proj-4' }) } as any
    )

    expect(res.status).toBe(200)
    expect(sendInngestEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'media/prepare-requested',
      data: expect.objectContaining({
        transcriptionOptions: {
          engine: 'deepgram',
          language: 'multi',
          detect_speakers: false,
          keep_filler_words: false,
          mask_profanity: true,
        },
      }),
    }))
  })

  test('filler words not recorded on the row start as kept', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-5', source_object_key: 'source-5', status: 'error', ...STORED_OPTIONS, keep_filler_words: null },
      error: null,
    })

    const res = await POST(
      { headers: new Headers({ [EXPECTED_USER_HEADER]: 'user-1' }) } as any,
      { params: Promise.resolve({ id: 'proj-5' }) } as any
    )

    expect(res.status).toBe(200)
    expect(sendInngestEvent).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS }),
    }))
  })
})
