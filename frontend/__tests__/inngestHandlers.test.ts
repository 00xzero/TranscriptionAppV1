/** @jest-environment node */

import { InngestTestEngine, mockCtx } from '@inngest/test'

jest.mock('@/core/transcription/transition', () => ({
  transitionJob: jest.fn(async () => ({ outcome: 'applied', previousStatus: 'processing' })),
  forceJobError: jest.fn(async () => undefined),
}))

type SelectRequest = {
  table: string
  columns: string
  filters: Record<string, unknown>
}

const mockDb = {
  jobPayload: null as Record<string, unknown> | null,
  deletedSegmentProjectIds: [] as string[],
  insertedSegments: [] as Record<string, unknown>[],
  insertedWordBatches: [] as Array<Record<string, unknown>[]>,
  upsertedSpeakers: [] as Record<string, unknown>[],
  segmentIdCounter: 0,
}

const projectUpdateEqMock = jest.fn(async () => ({ error: null }))
const projectUpdateMock = jest.fn(() => ({ eq: projectUpdateEqMock }))
const jobMaybeSingleMock = jest.fn(async (_request: SelectRequest) => ({ data: null, error: null }))
const jobSingleMock = jest.fn(async (request: SelectRequest) => {
  if (request.columns === 'payload') {
    return { data: { payload: mockDb.jobPayload }, error: null }
  }

  return { data: null, error: null }
})

function createSelectChain(table: string, columns: string) {
  const filters: Record<string, unknown> = {}
  const chain: any = {
    eq: jest.fn((field: string, value: unknown) => {
      filters[field] = value
      return chain
    }),
    in: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: () => jobMaybeSingleMock({ table, columns, filters }),
    single: () => jobSingleMock({ table, columns, filters }),
  }

  return chain
}

const fromMock = jest.fn((table: string) => {
  if (table === 'projects') {
    return {
      update: projectUpdateMock,
    }
  }
  if (table === 'jobs') {
    return {
      select: (columns: string) => createSelectChain(table, columns),
    }
  }
  if (table === 'segments') {
    return {
      delete: () => ({
        eq: async (_field: string, value: string) => {
          mockDb.deletedSegmentProjectIds.push(value)
          return { error: null }
        },
      }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mockDb.insertedSegments.push(row)
            mockDb.segmentIdCounter += 1
            return {
              data: { id: `segment-${mockDb.segmentIdCounter}` },
              error: null,
            }
          },
        }),
      }),
    }
  }
  if (table === 'words') {
    return {
      insert: async (rows: Record<string, unknown>[]) => {
        mockDb.insertedWordBatches.push(rows)
        return { error: null }
      },
    }
  }
  if (table === 'speakers') {
    return {
      upsert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mockDb.upsertedSpeakers.push(row)
            return {
              data: { id: `speaker-${mockDb.upsertedSpeakers.length}` },
              error: null,
            }
          },
        }),
      }),
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

function resetMockDb() {
  mockDb.jobPayload = null
  mockDb.deletedSegmentProjectIds = []
  mockDb.insertedSegments = []
  mockDb.insertedWordBatches = []
  mockDb.upsertedSpeakers = []
  mockDb.segmentIdCounter = 0
}

describe('Inngest handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetMockDb()
    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    jobSingleMock.mockImplementation(async (request: SelectRequest) => {
      if (request.columns === 'payload') {
        return { data: { payload: mockDb.jobPayload }, error: null }
      }

      return { data: null, error: null }
    })
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

  test('handleTranscriptionWebhook stores canonical segments with paragraph metadata', async () => {
    mockDb.jobPayload = {
      deepgram: {
        results: {
          channels: [{
            alternatives: [{
              transcript: 'Hello there. Different voice. New paragraph.',
              words: [
                { word: 'Hello', punctuated_word: 'Hello', start: 0, end: 0.2, confidence: 0.98, speaker: 0, speaker_confidence: 0.91 },
                { word: 'there', punctuated_word: 'there.', start: 0.22, end: 0.45, confidence: 0.98, speaker: 0 },
                { word: 'Different', punctuated_word: 'Different', start: 0.5, end: 0.72, confidence: 0.97, speaker: 1, speaker_confidence: 0.89 },
                { word: 'voice', punctuated_word: 'voice.', start: 0.74, end: 0.95, confidence: 0.97 },
                { word: 'New', punctuated_word: 'New', start: 1.3, end: 1.5, confidence: 0.99, speaker: 1 },
                { word: 'paragraph', punctuated_word: 'paragraph.', start: 1.52, end: 1.8, confidence: 0.99, speaker: 1 },
              ],
              paragraphs: {
                transcript: 'Hello there. Different voice. New paragraph.',
                paragraphs: [
                  {
                    speaker: 0,
                    start: 0,
                    end: 0.42,
                    num_words: 2,
                    sentences: [{ text: 'Hello there.', start: 0, end: 0.42 }],
                  },
                  {
                    speaker: 1,
                    start: 0.5,
                    end: 0.98,
                    num_words: 2,
                    sentences: [{ text: 'Different voice.', start: 0.5, end: 0.98 }],
                  },
                  {
                    speaker: 1,
                    start: 1.28,
                    end: 1.85,
                    num_words: 2,
                    sentences: [{ text: 'New paragraph.', start: 1.28, end: 1.85 }],
                  },
                ],
              },
            }],
          }],
        },
      },
    }

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'run-consolidation',
          handler: () => ({
            chunkCount: 3,
            chunkWordCount: 6,
            algoVersion: 'v1.3-ts',
            consolidationError: null,
          }),
        },
        {
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 3, wordCount: 6 }))
    expect(mockDb.deletedSegmentProjectIds).toEqual([projectId])
    expect(mockDb.insertedSegments).toHaveLength(3)
    expect(mockDb.insertedSegments[0]).toEqual(expect.objectContaining({
      project_id: projectId,
      speaker_id: 'speaker-1',
      is_filler: false,
      algo_version: 'v2.0-segments',
    }))
    expect(mockDb.insertedSegments[1]).toEqual(expect.objectContaining({
      speaker_id: 'speaker-2',
    }))
    expect(mockDb.insertedSegments[2]).toEqual(expect.objectContaining({
      speaker_id: 'speaker-2',
    }))

    const insertedWords = mockDb.insertedWordBatches.flat()
    expect(insertedWords).toHaveLength(6)
    expect(insertedWords[0]).toEqual(expect.objectContaining({
      speaker: 0,
      speaker_confidence: 0.91,
      punctuated_text: 'Hello',
      paragraph_index: 0,
      sentence_end: false,
    }))
    expect(insertedWords[1]).toEqual(expect.objectContaining({
      speaker: 0,
      punctuated_text: 'there.',
      paragraph_index: 0,
      sentence_end: true,
    }))
    expect(insertedWords[3]).toEqual(expect.objectContaining({
      speaker: 1,
      punctuated_text: 'voice.',
      paragraph_index: 1,
      sentence_end: true,
    }))

    expect(mockDb.upsertedSpeakers).toEqual([
      { project_id: projectId, label: 'Speaker 0' },
      { project_id: projectId, label: 'Speaker 1' },
    ])
  })

  test('handleTranscriptionWebhook preserves the no-words fallback', async () => {
    mockDb.jobPayload = {
      deepgram: {
        results: {
          channels: [{
            alternatives: [{
              transcript: 'No spoken words detected.',
              words: [],
            }],
          }],
        },
      },
    }

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'run-consolidation',
          handler: () => ({
            chunkCount: 1,
            chunkWordCount: 0,
            algoVersion: 'v1.3-ts',
            consolidationError: null,
          }),
        },
        {
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 1, wordCount: 0 }))
    expect(mockDb.insertedSegments).toHaveLength(1)
    expect(mockDb.insertedSegments[0]).toEqual(expect.objectContaining({
      text: 'No spoken words detected.',
      is_filler: false,
      algo_version: 'v2.0-segments',
    }))
    expect(mockDb.insertedWordBatches).toHaveLength(0)
  })

  test('handleTranscriptionWebhook skips replayed completed jobs without writing', async () => {
    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'completed' }),
        },
      ],
    })

    expect(result).toEqual({ status: 'skipped', projectId, jobId })
    expect(mockDb.deletedSegmentProjectIds).toHaveLength(0)
    expect(mockDb.insertedSegments).toHaveLength(0)
    expect(mockDb.insertedWordBatches).toHaveLength(0)
    expect(mockDb.upsertedSpeakers).toHaveLength(0)
  })

  test('handleTranscriptionWebhook builds segments without paragraph metadata', async () => {
    mockDb.jobPayload = {
      deepgram: {
        results: {
          channels: [{
            alternatives: [{
              transcript: 'Hello again. New speaker.',
              words: [
                { word: 'Hello', punctuated_word: 'Hello', start: 0, end: 0.2, confidence: 0.98, speaker: 0 },
                { word: 'again', punctuated_word: 'again.', start: 0.22, end: 0.45, confidence: 0.98 },
                { word: 'New', punctuated_word: 'New', start: 0.5, end: 0.7, confidence: 0.97, speaker: 1 },
                { word: 'speaker', punctuated_word: 'speaker.', start: 0.72, end: 0.95, confidence: 0.97 },
              ],
            }],
          }],
        },
      },
    }

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'run-consolidation',
          handler: () => ({
            chunkCount: 2,
            chunkWordCount: 4,
            algoVersion: 'v1.3-ts',
            consolidationError: null,
          }),
        },
        {
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 2, wordCount: 4 }))
    expect(mockDb.insertedSegments).toHaveLength(2)
    expect(mockDb.insertedWordBatches.flat().map((row) => row.paragraph_index)).toEqual([null, null, null, null])
    expect(mockDb.insertedWordBatches.flat().map((row) => row.sentence_end)).toEqual([false, true, false, true])
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
