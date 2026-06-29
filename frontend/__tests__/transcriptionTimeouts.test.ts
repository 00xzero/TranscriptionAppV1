/** @jest-environment node */

import { InngestTestEngine } from '@inngest/test'

const transitionJobMock = jest.fn()

jest.mock('@/core/transcription/transition', () => ({
  transitionJob: (...args: unknown[]) => transitionJobMock(...args),
  forceJobError: jest.fn(),
}))

const fromMock = jest.fn()

jest.mock('@/infra/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: fromMock,
    }),
  }
})

import { handleTranscriptionTimeouts } from '@/lib/inngest/functions'

const jobsSelectMock = jest.fn()

const staleInMock = jest.fn()
const staleEqMock = jest.fn()
const staleIsMock = jest.fn()
const staleLtMock = jest.fn()

const staleSelectChain = {
  in: staleInMock,
  eq: staleEqMock,
  is: staleIsMock,
  lt: staleLtMock,
}

const payloadMaybeSingleMock = jest.fn()
const payloadEqMock = jest.fn(() => ({ maybeSingle: payloadMaybeSingleMock }))
const payloadSelectChain = {
  eq: payloadEqMock,
}

function getErrorMessage(error: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') return error.message
    if ('error' in error && typeof error.error === 'string') return error.error
    return JSON.stringify(error)
  }
  return String(error)
}

const scheduledEvent = {
  name: 'inngest/scheduled.timer',
  data: { cron: '*/10 * * * *' },
} as const

describe('Transcription timeouts', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    staleInMock.mockImplementation(() => staleSelectChain)
    staleEqMock.mockImplementation(() => staleSelectChain)
    staleIsMock.mockImplementation(() => staleSelectChain)

    jobsSelectMock.mockImplementation((columns: string) => {
      if (columns === 'payload') return payloadSelectChain
      return staleSelectChain
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'jobs') {
        return { select: jobsSelectMock }
      }
      return {}
    })
  })

  test('calls transitionJob per stale job with to: error', async () => {
    const job1 = {
      id: 'job-1',
      transcript_id: 'proj-1',
      status: 'processing',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: '2020-01-01T00:00:00.000Z',
    }
    const job2 = {
      id: 'job-2',
      transcript_id: 'proj-2',
      status: 'queued',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: null,
    }

    staleLtMock
      .mockResolvedValueOnce({ data: [job1], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [job2], error: null })

    payloadMaybeSingleMock.mockResolvedValueOnce({
      data: { payload: { existing: true } },
      error: null,
    })

    transitionJobMock.mockResolvedValue({ outcome: 'applied' })
    const engine = new InngestTestEngine({ function: handleTranscriptionTimeouts })

    const { result } = await engine.execute({ events: [scheduledEvent] })

    expect(result).toEqual(
      expect.objectContaining({
        timedOutJobs: 2,
      })
    )
    expect(transitionJobMock).toHaveBeenCalledTimes(2)
    expect(transitionJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        to: 'error',
        context: 'handleTranscriptionTimeouts',
      })
    )
    expect(transitionJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-2',
        to: 'error',
        context: 'handleTranscriptionTimeouts',
      })
    )
    expect(staleInMock).toHaveBeenCalledWith('type', ['transcription', 'transcribe'])
  })

  test('skips jobs that are already handled (noop/conflict)', async () => {
    const job1 = {
      id: 'job-1',
      transcript_id: 'proj-1',
      status: 'queued',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: null,
    }

    staleLtMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [job1], error: null })

    transitionJobMock.mockResolvedValueOnce({ outcome: 'noop' })
    const engine = new InngestTestEngine({ function: handleTranscriptionTimeouts })

    await engine.execute({ events: [scheduledEvent] })

    expect(transitionJobMock).toHaveBeenCalledTimes(1)
  })

  test('aggregates failures from invalid transitions', async () => {
    const job1 = {
      id: 'job-1',
      transcript_id: 'proj-1',
      status: 'processing',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: '2020-01-01T00:00:00.000Z',
    }

    staleLtMock
      .mockResolvedValueOnce({ data: [job1], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    payloadMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'payload fetch failed' },
    })

    const engine = new InngestTestEngine({ function: handleTranscriptionTimeouts })
    const { error } = await engine.execute({ events: [scheduledEvent] })

    expect(error).not.toBeNull()
    expect(getErrorMessage(error)).toContain('job-1')
    expect(getErrorMessage(error)).toContain('payload fetch failed')
  })
})
