/** @jest-environment node */

const jobEqMock = jest.fn(async () => ({ error: { message: 'job update failed' } }))
const projectEqMock = jest.fn(async () => ({ error: null }))
const fromMock = jest.fn((table: string) => ({
  update: () => ({
    eq: table === 'jobs' ? jobEqMock : projectEqMock,
  }),
}))

jest.mock('@/lib/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: fromMock,
    }),
  }
})

import { handleTranscriptionCompleted, handleTranscriptionWebhook } from '@/lib/inngest/functions'

describe('Inngest handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('handleTranscriptionCompleted throws when status updates fail', async () => {
    const handler = (handleTranscriptionCompleted as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await expect(
      handler({
        event: { data: { projectId: 'proj-1', jobId: 'job-1', duration: 120 } },
        step,
      })
    ).rejects.toThrow('Failed to update completion status')

    expect(fromMock).toHaveBeenCalledWith('jobs')
    expect(fromMock).toHaveBeenCalledWith('projects')
    expect(jobEqMock).toHaveBeenCalledWith('id', 'job-1')
    expect(projectEqMock).toHaveBeenCalledWith('id', 'proj-1')
  })

  test('handleTranscriptionWebhook surfaces completed-event send failures', async () => {
    const handler = (handleTranscriptionWebhook as any).fn
    const step = {
      run: jest.fn((name: string) => {
        if (name === 'find-job') return { id: 'job-1' }
        if (name === 'store-transcription') return { segmentCount: 1, wordCount: 2, durationMs: 1000 }
        if (name === 'run-consolidation') return { chunkCount: 0, chunkWordCount: 0, algoVersion: 'skipped' }
        throw new Error(`Unexpected step: ${name}`)
      }),
      sendEvent: jest.fn(() => {
        throw new Error('send failed')
      }),
    }

    await expect(
      handler({
        event: { data: { projectId: 'proj-1', requestId: 'req-1' } },
        step,
      })
    ).rejects.toThrow('send failed')

    expect(step.sendEvent).toHaveBeenCalled()
  })
})
