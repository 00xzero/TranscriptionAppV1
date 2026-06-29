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

type RpcResponse = { data: unknown; error: { message: string } | null }

type RpcCall = {
  fn: string
  args: Record<string, unknown>
}

const mockDb = {
  jobPayload: null as Record<string, unknown> | null,
  rpcCalls: [] as RpcCall[],
}

// Per-call rpc response queue. Tests push responses to override the default
// success summary. Reset in beforeEach.
const rpcResponseQueue: RpcResponse[] = []

const transcriptUpdateEqMock = jest.fn(async () => ({ error: null }))
const transcriptUpdateMock = jest.fn(() => ({ eq: transcriptUpdateEqMock }))
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
  if (table === 'transcripts') {
    return {
      update: transcriptUpdateMock,
    }
  }
  if (table === 'jobs') {
    return {
      select: (columns: string) => createSelectChain(table, columns),
    }
  }
  return {}
})

const rpcMock = jest.fn(async (fn: string, args: Record<string, unknown>): Promise<RpcResponse> => {
  mockDb.rpcCalls.push({ fn, args })

  const override = rpcResponseQueue.shift()
  if (override) return override

  // Default success response for save_transcript_segments — derive plausible
  // counts from the payload so most tests don't need to override.
  if (fn === 'save_transcript_segments') {
    const payload = args.p_payload as { segments?: Array<{ end_ms: number; words: unknown[] }> }
    const segments = payload?.segments ?? []
    const segmentCount = segments.length
    const wordCount = segments.reduce((sum, s) => sum + (s.words?.length ?? 0), 0)
    const durationMs = segments.reduce((max, s) => Math.max(max, s.end_ms ?? 0), 0)
    return {
      data: {
        segment_count: segmentCount,
        word_count: wordCount,
        duration_ms: durationMs,
      },
      error: null,
    }
  }

  return { data: null, error: null }
})

jest.mock('@/infra/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: fromMock,
      rpc: rpcMock,
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

const transcriptId = '11111111-1111-4111-8111-111111111111'
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
  data: { transcriptId, jobId, duration: 120 },
} as const

const failedEvent = {
  name: 'transcription/failed',
  data: {
    transcriptId,
    error: 'Deepgram request failed',
    errorType: 'transcription_error' as const,
  },
} as const

const webhookEvent = {
  name: 'transcription/webhook',
  data: { transcriptId, requestId },
} as const

function resetMockDb() {
  mockDb.jobPayload = null
  mockDb.rpcCalls = []
  rpcResponseQueue.length = 0
}

function getSavePayload(): {
  speakers: Array<{ num: number; label: string }>
  segments: Array<Record<string, unknown>>
} {
  const call = mockDb.rpcCalls.find((c) => c.fn === 'save_transcript_segments')
  if (!call) {
    throw new Error('save_transcript_segments was not called')
  }
  return call.args.p_payload as {
    speakers: Array<{ num: number; label: string }>
    segments: Array<Record<string, unknown>>
  }
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
        transcriptId,
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
    expect(transcriptUpdateEqMock).toHaveBeenCalledWith('id', transcriptId)
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
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
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
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ duration_seconds: 120 })
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
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 3, wordCount: 6 }))

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('save_transcript_segments', expect.objectContaining({
      p_transcript_id: transcriptId,
    }))

    const payload = getSavePayload()
    expect(payload.segments).toHaveLength(3)

    // Each segment must carry a freshly minted UUID (pre-generated client-side
    // so the RPC can wire words to segments without a round-trip).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    payload.segments.forEach((seg) => {
      expect(seg.id).toMatch(uuidRe)
    })

    expect(payload.segments[0]).toEqual(expect.objectContaining({
      speaker_num: 0,
      is_filler: false,
      algo_version: 'v2.0-segments',
    }))
    expect(payload.segments[1]).toEqual(expect.objectContaining({ speaker_num: 1 }))
    expect(payload.segments[2]).toEqual(expect.objectContaining({ speaker_num: 1 }))

    const allWords = payload.segments.flatMap((s) => (s.words as Record<string, unknown>[]))
    expect(allWords).toHaveLength(6)
    expect(allWords[0]).toEqual(expect.objectContaining({
      speaker: 0,
      speaker_confidence: 0.91,
      punctuated_text: 'Hello',
      paragraph_index: 0,
      sentence_end: false,
    }))
    expect(allWords[1]).toEqual(expect.objectContaining({
      speaker: 0,
      punctuated_text: 'there.',
      paragraph_index: 0,
      sentence_end: true,
    }))
    expect(allWords[3]).toEqual(expect.objectContaining({
      speaker: 1,
      punctuated_text: 'voice.',
      paragraph_index: 1,
      sentence_end: true,
    }))

    // Speakers are deduped and sorted; the RPC upserts these and joins on
    // speaker_num when resolving segment.speaker_id.
    expect(payload.speakers).toEqual([
      { num: 0, label: 'Speaker 0' },
      { num: 1, label: 'Speaker 1' },
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
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 1, wordCount: 0 }))

    const payload = getSavePayload()
    expect(payload.speakers).toEqual([])
    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0]).toEqual(expect.objectContaining({
      speaker_num: null,
      start_ms: 0,
      end_ms: 0,
      text: 'No spoken words detected.',
      is_filler: false,
      algo_version: 'v2.0-segments',
      words: [],
    }))
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

    expect(result).toEqual({ status: 'skipped', transcriptId, jobId })
    expect(rpcMock).not.toHaveBeenCalled()
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
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', segmentCount: 2, wordCount: 4 }))

    const payload = getSavePayload()
    expect(payload.segments).toHaveLength(2)
    const allWords = payload.segments.flatMap((s) => (s.words as Record<string, unknown>[]))
    expect(allWords.map((w) => w.paragraph_index)).toEqual([null, null, null, null])
    expect(allWords.map((w) => w.sentence_end)).toEqual([false, true, false, true])
  })

  test('handleTranscriptionWebhook does not send completed event when the RPC fails (atomicity guard)', async () => {
    mockDb.jobPayload = {
      deepgram: {
        results: {
          channels: [{
            alternatives: [{
              transcript: 'Hello world.',
              words: [
                { word: 'Hello', punctuated_word: 'Hello', start: 0, end: 0.2, confidence: 0.98, speaker: 0 },
                { word: 'world', punctuated_word: 'world.', start: 0.22, end: 0.45, confidence: 0.98, speaker: 0 },
              ],
            }],
          }],
        },
      },
    }

    // Force the next RPC call to fail. The whole transaction inside the RPC
    // rolls back; the handler should propagate the error and never emit
    // transcription/completed.
    rpcResponseQueue.push({
      data: null,
      error: { message: 'simulated rollback' },
    })

    const triggerCompletedHandler = jest.fn(() => undefined)
    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { error } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'trigger-completed',
          handler: triggerCompletedHandler,
        },
      ],
    })

    expect(getErrorMessage(error)).toContain('simulated rollback')
    expect(triggerCompletedHandler).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  test('handleTranscriptionWebhook throws when the RPC returns a malformed summary', async () => {
    mockDb.jobPayload = {
      deepgram: {
        results: {
          channels: [{
            alternatives: [{
              transcript: 'Hello.',
              words: [
                { word: 'Hello', punctuated_word: 'Hello.', start: 0, end: 0.2, confidence: 0.98, speaker: 0 },
              ],
            }],
          }],
        },
      },
    }

    // Bad-shape response: missing required fields. Zod should reject it.
    rpcResponseQueue.push({
      data: { segment_count: 'not-a-number' },
      error: null,
    })

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })

    const { error } = await engine.execute({
      events: [webhookEvent],
      steps: [
        {
          id: 'find-job',
          handler: () => ({ id: jobId, status: 'processing' }),
        },
        {
          id: 'trigger-completed',
          handler: () => undefined,
        },
      ],
    })

    // Zod throws a ZodError; the message includes details about the failed parse.
    expect(error).toBeDefined()
  })

  test('handleTranscriptionFailed marks transcript error when no active job can be found', async () => {
    const engine = new InngestTestEngine({ function: handleTranscriptionFailed })

    await engine.execute({ events: [failedEvent] })

    expect(mockTransitionJob).not.toHaveBeenCalled()
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(transcriptUpdateEqMock).toHaveBeenCalledWith('id', transcriptId)
  })

  test('failure fallback marks transcript error when no job can be resolved', async () => {
    await writeTranscriptionFailureFallback({
      transcriptId,
      payload: {
        error: 'Transcription failed: send failed',
        error_type: 'transcription_error',
        raw_error: 'send failed',
      },
      context: 'onFailure',
    })

    expect(mockForceJobError).not.toHaveBeenCalled()
    expect(transcriptUpdateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(transcriptUpdateEqMock).toHaveBeenCalledWith('id', transcriptId)
  })
})
