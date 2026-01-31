/** @jest-environment node */

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
const jobsUpdateMock = jest.fn()
const projectsUpdateMock = jest.fn()

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

const jobUpdateSelectMock = jest.fn()
const jobUpdateInMock = jest.fn(() => ({ select: jobUpdateSelectMock }))
const jobUpdateEqMock = jest.fn(() => ({ in: jobUpdateInMock }))

const projectUpdateInStatusMock = jest.fn()
const projectUpdateInMock = jest.fn(() => ({ in: projectUpdateInStatusMock }))

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

    jobsUpdateMock.mockImplementation(() => ({ eq: jobUpdateEqMock }))
    projectsUpdateMock.mockImplementation(() => ({ in: projectUpdateInMock }))

    fromMock.mockImplementation((table: string) => {
      if (table === 'jobs') {
        return { select: jobsSelectMock, update: jobsUpdateMock }
      }
      if (table === 'projects') {
        return { update: projectsUpdateMock }
      }
      return {}
    })
  })

  test('continues marking stale jobs and aggregates failures', async () => {
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
      data: null,
      error: { message: 'payload fetch failed' },
    })

    jobUpdateSelectMock.mockResolvedValue({ data: [{ id: 'job-2' }], error: null })
    projectUpdateInStatusMock.mockResolvedValue({ error: null })

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
    expect(jobUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(jobUpdateEqMock).toHaveBeenCalledWith('id', 'job-2')
    expect(projectUpdateInMock).toHaveBeenCalledWith('id', ['proj-2'])
    expect(projectUpdateInStatusMock).toHaveBeenCalledWith('status', ['queued', 'processing'])
  })
})
