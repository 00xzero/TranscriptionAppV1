/** @jest-environment node */

jest.mock('@/core/transcription/transition', () => ({
  transitionJob: jest.fn(async () => ({ outcome: 'applied', previousStatus: 'processing' })),
  forceJobError: jest.fn(async () => undefined),
}))

const projectUpdateEqMock = jest.fn(async () => ({ error: null }))
const projectUpdateMock = jest.fn(() => ({ eq: projectUpdateEqMock }))
const jobMaybeSingleMock = jest.fn(async () => ({ data: null, error: null }))
const jobSingleMock = jest.fn(async () => ({ data: null, error: null }))
const jobSelectChain: any = {
  eq: jest.fn(() => jobSelectChain),
  in: jest.fn(() => jobSelectChain),
  order: jest.fn(() => jobSelectChain),
  limit: jest.fn(() => jobSelectChain),
  maybeSingle: jobMaybeSingleMock,
  single: jobSingleMock,
}
const fromMock = jest.fn((table: string) => {
  if (table === 'projects') {
    return {
      update: projectUpdateMock,
    }
  }
  if (table === 'jobs') {
    return {
      select: () => jobSelectChain,
    }
  }
  return {}
})

jest.mock('@/infra/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: fromMock,
    }),
  }
})

import {
  handleTranscriptionCompleted,
  handleTranscriptionFailed,
  handleTranscriptionWebhook,
} from '@/lib/inngest/functions'
import { inngest } from '@/infra/inngest/client'
import { forceJobError, transitionJob } from '@/core/transcription/transition'

const mockTransitionJob = transitionJob as jest.MockedFunction<typeof transitionJob>
const mockForceJobError = forceJobError as jest.MockedFunction<typeof forceJobError>

describe('Inngest handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    jobSingleMock.mockResolvedValue({ data: null, error: null })
  })

  test('handleTranscriptionCompleted calls transitionJob with correct args', async () => {
    const handler = (handleTranscriptionCompleted as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await handler({
      event: { data: { projectId: 'proj-1', jobId: 'job-1', duration: 120 } },
      step,
    })

    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        to: 'completed',
        context: 'handleTranscriptionCompleted',
      })
    )

    // Project update should only set duration, not status
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', 'proj-1')
  })

  test('handleTranscriptionCompleted throws on transition conflict', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'conflict', previousStatus: 'processing' })

    const handler = (handleTranscriptionCompleted as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await expect(
      handler({
        event: { data: { projectId: 'proj-1', jobId: 'job-1', duration: 120 } },
        step,
      })
    ).rejects.toThrow('Failed to transition job')
  })

  test('handleTranscriptionCompleted accepts late success after timeout', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'applied', previousStatus: 'error' })

    const handler = (handleTranscriptionCompleted as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await handler({
      event: { data: { projectId: 'proj-1', jobId: 'job-1', duration: 120 } },
      step,
    })

    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        to: 'completed',
      })
    )
    expect(projectUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
  })

  test('handleTranscriptionCompleted accepts success before processing flip lands', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'applied', previousStatus: 'queued' })

    const handler = (handleTranscriptionCompleted as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await handler({
      event: { data: { projectId: 'proj-1', jobId: 'job-1', duration: 120 } },
      step,
    })

    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        to: 'completed',
      })
    )
    expect(projectUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
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

  test('handleTranscriptionFailed marks project error when no active job can be found', async () => {
    const handler = (handleTranscriptionFailed as any).fn
    const step = {
      run: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    }

    await handler({
      event: {
        data: {
          projectId: 'proj-1',
          jobId: '',
          error: 'Deepgram request failed',
          errorType: 'transcription_error',
        },
      },
      step,
    })

    expect(mockTransitionJob).not.toHaveBeenCalled()
    expect(projectUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', 'proj-1')
  })

  test('webhook onFailure falls back to project error when no job can be resolved', async () => {
    const onFailure = (handleTranscriptionWebhook as any).onFailureFn
    const sendSpy = jest.spyOn(inngest, 'send').mockRejectedValueOnce(new Error('send failed'))

    await onFailure({
      event: {
        data: {
          event: {
            data: {
              projectId: 'proj-1',
              requestId: 'req-1',
            },
          },
        },
      },
      error: new Error('webhook failed'),
    })

    expect(mockForceJobError).not.toHaveBeenCalled()
    expect(projectUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', 'proj-1')

    sendSpy.mockRestore()
  })
})
