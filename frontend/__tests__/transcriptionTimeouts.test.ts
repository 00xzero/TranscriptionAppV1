/** @jest-environment node */

const transitionJobMock = jest.fn()

jest.mock('@/lib/supabase/transition', () => ({
  transitionJob: (...args: unknown[]) => transitionJobMock(...args),
  forceJobError: jest.fn(),
}))

const fromMock = jest.fn()

jest.mock('@/lib/supabase/admin', () => {
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
      project_id: 'proj-1',
      status: 'processing',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: '2020-01-01T00:00:00.000Z',
    }
    const job2 = {
      id: 'job-2',
      project_id: 'proj-2',
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

    const handler = (handleTranscriptionTimeouts as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await handler({ step })

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
      project_id: 'proj-1',
      status: 'queued',
      created_at: '2020-01-01T00:00:00.000Z',
      started_at: null,
    }

    staleLtMock
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [job1], error: null })

    transitionJobMock.mockResolvedValueOnce({ outcome: 'noop' })

    const handler = (handleTranscriptionTimeouts as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    // Should not throw — noop is handled gracefully
    await handler({ step })

    expect(transitionJobMock).toHaveBeenCalledTimes(1)
  })

  test('aggregates failures from invalid transitions', async () => {
    const job1 = {
      id: 'job-1',
      project_id: 'proj-1',
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

    const handler = (handleTranscriptionTimeouts as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    let caught: Error | null = null
    try {
      await handler({ step })
    } catch (error) {
      caught = error as Error
    }

    expect(caught).not.toBeNull()
    expect(caught?.message).toContain('job-1')
    expect(caught?.message).toContain('payload fetch failed')
  })
})
