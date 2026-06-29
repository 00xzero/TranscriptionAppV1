/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/infra/supabase/storage', () => {
  return {
    getMediaUrlForDeepgram: jest.fn(),
  }
})

jest.mock('@/infra/supabase/server', () => {
  return {
    createClient: () => ({
      auth: {
        getUser: getUserMock,
      },
      from: fromMock,
    }),
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
import { getMediaUrlForDeepgram } from '@/infra/supabase/storage'

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
    ;(getMediaUrlForDeepgram as jest.Mock).mockResolvedValue({
      url: 'https://example.com/media.mp3',
      error: null,
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'transcripts') {
        return { select: transcriptSelectMock, update: transcriptUpdateMock }
      }
      if (table === 'jobs') {
        return { select: jobsSelectMock, insert: jobsInsertMock }
      }
      if (table === 'watchlist') {
        return { select: watchlistSelectMock }
      }
      return {}
    })

    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
  })

  afterEach(() => {
    process.env.RATE_LIMIT_MODE = originalRateLimitMode
  })

  test('returns cached job when transcript is queued and idempotency key matches', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'queued' },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: { id: 'job-1', status: 'queued' },
      error: null,
    })

    const request = {
      headers: new Headers({ 'x-idempotency-key': 'idem-1' }),
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
      data: { id: 'proj-err', source_object_key: 'source-err', status: 'error' },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: { id: 'job-err', status: 'error' },
      error: null,
    })

    const request = {
      headers: new Headers({ 'x-idempotency-key': 'idem-error-state' }),
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

  test('creates a new job when no cached job exists', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-1', source_object_key: 'source-1', status: 'created' },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: null,
      error: null,
    })

    const request = {
      headers: new Headers({ 'x-idempotency-key': 'idem-new' }),
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

  test('continues when idempotency lookup fails', async () => {
    transcriptSingleMock.mockResolvedValue({
      data: { id: 'proj-2', source_object_key: 'source-2', status: 'created' },
      error: null,
    })

    jobsMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'lookup failed' },
    })

    const request = {
      headers: new Headers({ 'x-idempotency-key': 'idem-error' }),
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
      data: { id: 'proj-3', source_object_key: 'source-3', status: 'created' },
      error: null,
    })

    const request = {
      headers: new Headers(),
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
})
