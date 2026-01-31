/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

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

const projectSingleMock = jest.fn()
const projectEqMock = jest.fn(() => ({ single: projectSingleMock }))
const projectSelectMock = jest.fn(() => ({ eq: projectEqMock }))

const jobsMaybeSingleMock = jest.fn()
const jobsEqMock = jest.fn()
const jobsSelectChain = {
  eq: jobsEqMock,
  maybeSingle: jobsMaybeSingleMock,
}
const jobsSelectMock = jest.fn(() => jobsSelectChain)

describe('Start route idempotency', () => {
  const originalRateLimitMode = process.env.RATE_LIMIT_MODE

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.RATE_LIMIT_MODE = 'off'

    projectSingleMock.mockReset()
    projectEqMock.mockClear()
    projectSelectMock.mockClear()
    jobsMaybeSingleMock.mockReset()
    jobsEqMock.mockClear()
    jobsSelectMock.mockClear()

    jobsEqMock.mockImplementation(() => jobsSelectChain)

    fromMock.mockImplementation((table: string) => {
      if (table === 'projects') {
        return { select: projectSelectMock }
      }
      if (table === 'jobs') {
        return { select: jobsSelectMock }
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
})
