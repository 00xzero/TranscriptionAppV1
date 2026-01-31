/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/lib/supabase/storage', () => {
  return {
    getSignedMediaUrl: jest.fn(),
  }
})

jest.mock('@/lib/supabase/server', () => {
  return {
    createClient: () => ({
      auth: {
        getUser: getUserMock,
      },
      from: fromMock,
    }),
  }
})

jest.mock('@/lib/inngest/client', () => {
  return {
    inngest: {
      send: jest.fn(async () => undefined),
    },
  }
})

import { POST } from '../app/api/projects/[id]/start/route'
import { getSignedMediaUrl } from '@/lib/supabase/storage'

const projectSingleMock = jest.fn()
const projectEqMock = jest.fn(() => ({ single: projectSingleMock }))
const projectSelectMock = jest.fn(() => ({ eq: projectEqMock }))
const projectUpdateEqMock = jest.fn()
const projectUpdateMock = jest.fn(() => ({ eq: projectUpdateEqMock }))

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

    projectSingleMock.mockReset()
    projectEqMock.mockClear()
    projectSelectMock.mockClear()
    projectUpdateEqMock.mockReset()
    projectUpdateMock.mockClear()
    jobsMaybeSingleMock.mockReset()
    jobsEqMock.mockClear()
    jobsSelectMock.mockClear()
    jobsInsertSingleMock.mockReset()
    jobsInsertSelectMock.mockClear()
    jobsInsertMock.mockClear()
    watchlistEqMock.mockReset()
    watchlistSelectMock.mockClear()

    jobsEqMock.mockImplementation(() => jobsSelectChain)
    projectUpdateEqMock.mockResolvedValue({ error: null })
    jobsInsertSingleMock.mockResolvedValue({ data: { id: 'job-new' }, error: null })
    watchlistEqMock.mockResolvedValue({ data: [], error: null })
    ;(getSignedMediaUrl as jest.Mock).mockResolvedValue({
      url: 'https://example.com/media.mp3',
      error: null,
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'projects') {
        return { select: projectSelectMock, update: projectUpdateMock }
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

  test('returns cached job when project is queued and idempotency key matches', async () => {
    projectSingleMock.mockResolvedValue({
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
    projectSingleMock.mockResolvedValue({
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
    projectSingleMock.mockResolvedValue({
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
    expect(jobsInsertMock.mock.calls[0][0]).toMatchObject({
      project_id: 'proj-1',
      status: 'queued',
      type: 'transcription',
      idempotency_key: 'idem-new',
    })
  })

  test('continues when idempotency lookup fails', async () => {
    projectSingleMock.mockResolvedValue({
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
    projectSingleMock.mockResolvedValue({
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
    const insertPayload = jobsInsertMock.mock.calls[0][0]
    expect(insertPayload).toMatchObject({
      project_id: 'proj-3',
      status: 'queued',
      type: 'transcription',
    })
    expect(insertPayload).not.toHaveProperty('idempotency_key')
  })
})
