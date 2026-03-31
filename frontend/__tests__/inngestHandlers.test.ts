/** @jest-environment node */

import { InngestTestEngine, mockCtx } from '@inngest/test'

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
import { forceJobError, transitionJob } from '@/core/transcription/transition'
import { writeTranscriptionFailureFallback } from '@/lib/inngest/functions/_shared'

const mockTransitionJob = transitionJob as jest.MockedFunction<typeof transitionJob>
const mockForceJobError = forceJobError as jest.MockedFunction<typeof forceJobError>

const projectId = '11111111-1111-4111-8111-111111111111'
const jobId = '22222222-2222-4222-8222-222222222222'
const requestId = 'req-1'

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

const completedEvent = {
  name: 'transcription/completed',
  data: { projectId, jobId, duration: 120 },
} as const

const failedEvent = {
  name: 'transcription/failed',
  data: {
    projectId,
    error: 'Deepgram request failed',
    errorType: 'transcription_error' as const,
  },
} as const

const webhookEvent = {
  name: 'transcription/webhook',
  data: { projectId, requestId },
} as const

describe('Inngest handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    jobSingleMock.mockResolvedValue({ data: null, error: null })
  })

  test('handleTranscriptionCompleted calls transitionJob with correct args', async () => {
    const engine = new InngestTestEngine({ function: handleTranscriptionCompleted })

    const { result } = await engine.execute({ events: [completedEvent] })

    expect(result).toEqual(
      expect.objectContaining({
        status: 'completed',
        projectId,
        jobId,
      })
    )
    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        to: 'completed',
        context: 'handleTranscriptionCompleted',
      })
    )
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', projectId)
  })

  test('handleTranscriptionCompleted throws on transition conflict', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'conflict', previousStatus: 'processing' })
    const engine = new InngestTestEngine({ function: handleTranscriptionCompleted })

    const { error } = await engine.execute({ events: [completedEvent] })

    expect(getErrorMessage(error)).toContain('Failed to transition job')
  })

  test('handleTranscriptionCompleted accepts late success after timeout', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'applied', previousStatus: 'error' })
    const engine = new InngestTestEngine({ function: handleTranscriptionCompleted })

    await engine.execute({ events: [completedEvent] })

    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        to: 'completed',
      })
    )
    expect(projectUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
  })

  test('handleTranscriptionCompleted accepts success before processing flip lands', async () => {
    mockTransitionJob.mockResolvedValueOnce({ outcome: 'applied', previousStatus: 'queued' })
    const engine = new InngestTestEngine({ function: handleTranscriptionCompleted })

    await engine.execute({ events: [completedEvent] })

    expect(mockTransitionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        to: 'completed',
      })
    )
    expect(projectUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
  })

  test('handleTranscriptionWebhook surfaces completed-event send failures', async () => {
    const engine = new InngestTestEngine({
      function: handleTranscriptionWebhook,
      transformCtx(rawCtx) {
        const ctx = mockCtx(rawCtx) as any
        ctx.step.sendEvent.mockImplementation(() => {
          throw new Error('send failed')
        })
        return ctx
      },
    })

    const { error, ctx } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'store-transcription',
          handler: () => ({ segmentCount: 1, wordCount: 2, durationMs: 1000 }),
        },
        {
          id: 'run-consolidation',
          handler: () => ({
            chunkCount: 0,
            chunkWordCount: 0,
            algoVersion: 'skipped',
            consolidationError: null,
          }),
        },
      ],
    })

    expect(getErrorMessage(error)).toContain('send failed')
    expect(ctx.step.sendEvent).toHaveBeenCalled()
  })

  test('handleTranscriptionFailed marks project error when no active job can be found', async () => {
    const engine = new InngestTestEngine({ function: handleTranscriptionFailed })

    await engine.execute({ events: [failedEvent] })

    expect(mockTransitionJob).not.toHaveBeenCalled()
    expect(projectUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', projectId)
  })

  test('failure fallback marks project error when no job can be resolved', async () => {
    await writeTranscriptionFailureFallback({
      projectId,
      payload: {
        error: 'Transcription failed: send failed',
        error_type: 'transcription_error',
        raw_error: 'send failed',
      },
      context: 'onFailure',
    })

    expect(mockForceJobError).not.toHaveBeenCalled()
    expect(projectUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(projectUpdateEqMock).toHaveBeenCalledWith('id', projectId)
  })
})
