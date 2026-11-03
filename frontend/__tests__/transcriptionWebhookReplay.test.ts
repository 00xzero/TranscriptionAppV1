/** @jest-environment node */

/**
 * Audit finding pipeline-3: a second transcription/webhook for a job that has
 * already completed must not replace the transcript's segments. The hand-off
 * carries the job's own event id, so Inngest drops a resend; and a duplicate
 * run that read the job before it completed is refused at the save (SP005,
 * scripts/smoke-test-segment-save-guard.sql) and skips without completing.
 */

import { InngestTestEngine } from '@inngest/test'
import { FakeAdmin, type Row } from './helpers/fakeAdmin'

const mockSend = jest.fn()
const mockAdmin: { db: FakeAdmin | null } = { db: null }
const mockStoredResult = {
  results: {
    channels: [{
      alternatives: [{
        transcript: 'Helo wrold.',
        words: [
          { word: 'helo', punctuated_word: 'Helo', start: 0, end: 0.4, confidence: 0.9, speaker: 0 },
          { word: 'wrold', punctuated_word: 'wrold.', start: 0.45, end: 0.9, confidence: 0.9, speaker: 0 },
        ],
      }],
    }],
  },
}

jest.mock('@/infra/inngest/client', () => ({
  ...jest.requireActual('@/infra/inngest/client'),
  sendInngestEvent: (...a: unknown[]) => mockSend(...a),
}))
jest.mock('@/infra/supabase/transcription-results.server', () => ({
  uploadTranscriptionResult: jest.fn(async () => undefined),
  removeTranscriptionResult: jest.fn(async () => undefined),
  downloadTranscriptionResult: jest.fn(async () => JSON.stringify(mockStoredResult)),
}))
jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => mockAdmin.db!.asClient(),
}))

import { recordEngineResult } from '@/core/transcription/webhook'
import { handleTranscriptionWebhook } from '@/lib/inngest/functions'

const userId = '22222222-2222-4222-8222-222222222222'
const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-33333333333a'
const requestId = 'aaaaaaaa-0000-4000-8000-00000000000a'
const resultKey = `${userId}/${transcriptId}/${jobId}.json.gz`

type RpcCall = { fn: string; args: Record<string, unknown> }

/**
 * A database holding one job for the transcript. Saves are recorded, and
 * refused as the database refuses them: unless the job they name is the
 * transcript's and still processing.
 */
function setup(state: { job: Row; transcript: Row }) {
  const db = new FakeAdmin()
  const rpcCalls: RpcCall[] = []
  db.tables.transcripts.push({ id: transcriptId, user_id: userId, engine: 'deepgram', ...state.transcript })
  db.tables.jobs.push({
    id: jobId,
    transcript_id: transcriptId,
    inngest_event_id: requestId,
    result_object_key: null,
    created_at: '2026-11-02T00:00:00Z',
    ...state.job,
  })
  Object.assign(db, {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      const job = db.rows('jobs').find((row) => row.id === args.p_job_id)
      if (job?.transcript_id !== args.p_transcript_id || job?.status !== 'processing') {
        return { data: null, error: { code: 'SP005', message: 'only the running attempt may save segments' } }
      }
      return { data: { segment_count: 1, word_count: 2, duration_ms: 900 }, error: null }
    },
  })
  mockAdmin.db = db
  return { db, rpcCalls }
}

const webhookEvent = { name: 'transcription/webhook', data: { requestId, transcriptId } } as const

beforeEach(() => {
  jest.clearAllMocks()
  mockSend.mockResolvedValue({ ids: ['evt'] })
})

describe('pipeline-3: a duplicate transcription/webhook', () => {
  test('the hand-off carries the job\'s own event id, so a send retried after a lost answer is the same event', async () => {
    const { db } = setup({ job: { status: 'processing' }, transcript: { status: 'processing' } })
    const delivered: unknown[] = []
    // Inngest accepts the first event, but its answer never arrives.
    mockSend
      .mockImplementationOnce(async (event: unknown) => {
        delivered.push(event)
        throw new Error('socket hang up')
      })
      .mockImplementationOnce(async (event: unknown) => {
        delivered.push(event)
        return { ids: ['evt'] }
      })
    const record = () => recordEngineResult({
      supabase: db.asClient(),
      engine: 'soniox',
      transcriptId,
      jobId,
      requestId,
      rawBody: '{"result":true}',
    })

    await expect(record()).rejects.toThrow('socket hang up')
    // The step's retry: the job still processes, the receipt was released.
    await expect(record()).resolves.toEqual(expect.objectContaining({ outcome: 'processed' }))

    // Inngest deduplicates events by id, so the resend starts no second run.
    expect(delivered).toHaveLength(2)
    expect(delivered[1]).toEqual(delivered[0])
    expect(delivered[0]).toEqual({
      name: 'transcription/webhook',
      id: `transcription-webhook:${jobId}`,
      data: { requestId, transcriptId },
    })
  })

  test('a duplicate run that starts after completion is skipped: its job read sees completed', async () => {
    const { rpcCalls } = setup({
      job: { status: 'completed', result_object_key: resultKey },
      transcript: { status: 'completed' },
    })

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })
    const { result } = await engine.execute({ events: [webhookEvent] })

    expect(result).toEqual({ status: 'skipped', transcriptId, jobId })
    expect(rpcCalls).toEqual([])
  })

  test('a duplicate run that read the job before completion is refused at the save, and completes nothing', async () => {
    // By the time its save step runs, the first run has finished and the user
    // may be editing: the job and transcript are completed.
    const { rpcCalls } = setup({
      job: { status: 'completed', result_object_key: resultKey },
      transcript: { status: 'completed' },
    })
    const triggerCompleted = jest.fn()

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })
    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [
        // Memoised from before the first run completed.
        { id: 'find-job', handler: () => ({ id: jobId, status: 'processing' }) },
        { id: 'trigger-completed', handler: triggerCompleted },
      ],
    })

    expect(result).toEqual({ status: 'skipped', transcriptId, jobId })
    expect(rpcCalls).toEqual([expect.objectContaining({
      fn: 'save_transcript_segments',
      args: expect.objectContaining({ p_transcript_id: transcriptId, p_job_id: jobId }),
    })])
    expect(triggerCompleted).not.toHaveBeenCalled()
  })

  test('the running attempt saves, naming its job, and completes', async () => {
    const { rpcCalls } = setup({
      job: { status: 'processing', result_object_key: resultKey },
      transcript: { status: 'processing' },
    })
    const triggerCompleted = jest.fn()

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })
    const { result } = await engine.execute({
      events: [webhookEvent],
      steps: [{ id: 'trigger-completed', handler: triggerCompleted }],
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stored', jobId }))
    expect(rpcCalls.map((call) => call.args.p_job_id)).toEqual([jobId])
    expect(triggerCompleted).toHaveBeenCalledTimes(1)
  })

  test('any other save failure still fails the step, so Inngest retries it', async () => {
    const { db } = setup({
      job: { status: 'processing', result_object_key: resultKey },
      transcript: { status: 'processing' },
    })
    Object.assign(db, { rpc: async () => ({ data: null, error: { code: '40P01', message: 'deadlock detected' } }) })
    const triggerCompleted = jest.fn()

    const engine = new InngestTestEngine({ function: handleTranscriptionWebhook })
    const { error } = await engine.execute({
      events: [webhookEvent],
      steps: [{ id: 'trigger-completed', handler: triggerCompleted }],
    })

    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('deadlock detected') }))
    expect(triggerCompleted).not.toHaveBeenCalled()
  })
})
