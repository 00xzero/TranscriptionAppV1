/** @jest-environment node */

/**
 * What each step of the Soniox callback handler returns, pinned. Inngest
 * replays a run caught mid-deploy from the steps' saved results, so moving the
 * handler onto the shared fetching handler must keep every step's id and the
 * shape of what it returns exactly as before.
 */

import { createHash } from 'crypto'
import { InngestTestEngine } from '@inngest/test'

const mockReadState = jest.fn()
const mockHandoffState = jest.fn()
const mockRecord = jest.fn()
const mockPersistFailure = jest.fn()
const mockConfirm = jest.fn()
const mockFetchTranscription = jest.fn()
const mockFetchTranscript = jest.fn()
const mockDelete = jest.fn()
const mockDownload = jest.fn()
const mockSend = jest.fn()
const mockInsert = jest.fn()
const mockFallback = jest.fn()

jest.mock('@/lib/inngest/engine-callback-state', () => ({
  readEngineCallbackState: (...a: unknown[]) => mockReadState(...a),
  engineHandoffState: (...a: unknown[]) => mockHandoffState(...a),
}))
jest.mock('@/core/transcription/webhook', () => ({
  recordEngineResult: (...a: unknown[]) => mockRecord(...a),
  persistWebhookFailure: (...a: unknown[]) => mockPersistFailure(...a),
  confirmReceiptCompleted: (...a: unknown[]) => mockConfirm(...a),
}))
jest.mock('@/infra/soniox', () => ({
  fetchSonioxTranscription: (...a: unknown[]) => mockFetchTranscription(...a),
  fetchSonioxTranscript: (...a: unknown[]) => mockFetchTranscript(...a),
  deleteSonioxTranscription: (...a: unknown[]) => mockDelete(...a),
}))
jest.mock('@/infra/supabase/transcription-results.server', () => ({
  downloadTranscriptionResult: (...a: unknown[]) => mockDownload(...a),
}))
jest.mock('@/infra/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }) }),
}))
jest.mock('@/lib/inngest/functions/_shared', () => ({
  writeTranscriptionFailureFallback: (...a: unknown[]) => mockFallback(...a),
}))
jest.mock('@/infra/inngest/client', () => {
  const actual = jest.requireActual('@/infra/inngest/client')
  return { ...actual, sendInngestEvent: (...a: unknown[]) => mockSend(...a) }
})

import { handleSonioxCallback } from '@/lib/inngest/functions/handle-soniox-callback'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const requestId = 'soniox-job-1'

const transcription = { id: requestId, status: 'completed', model: 'stt-async-v5' }
const transcript = { id: requestId, text: 'Hello.', tokens: [] }

function run(status: 'completed' | 'error' = 'completed') {
  const engine = new InngestTestEngine({ function: handleSonioxCallback })
  return engine.execute({
    events: [{ name: 'soniox/callback', data: { transcriptId, jobId, requestId, status } }],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReadState.mockResolvedValue({ state: 'fresh' })
  mockRecord.mockResolvedValue({ outcome: 'processed', attemptId: 'attempt-1' })
  mockConfirm.mockResolvedValue(true)
  mockPersistFailure.mockResolvedValue('job')
  mockFetchTranscription.mockResolvedValue({ raw: transcription, transcription })
  mockFetchTranscript.mockResolvedValue({ raw: transcript, transcript })
  mockDelete.mockResolvedValue(undefined)
  mockInsert.mockResolvedValue({ error: null })
  mockSend.mockResolvedValue({ ids: ['evt'] })
})

const STEP_IDS = ['check', 'store-result', 'record-failure', 'confirm-handoff', 'forget-at-soniox']

async function stepResults(status: 'completed' | 'error' = 'completed') {
  const engine = new InngestTestEngine({ function: handleSonioxCallback })
  const { result, state } = await engine.execute({
    events: [{ name: 'soniox/callback', data: { transcriptId, jobId, requestId, status } }],
  })
  // Inngest keys a step's saved result by the SHA-1 of its id, which is how a
  // replay finds it; a step that returns nothing is saved as null.
  const names = new Map(STEP_IDS.map((id) => [createHash('sha1').update(id).digest('hex'), id]))
  const steps: Record<string, unknown> = {}
  for (const [hash, value] of Object.entries(state)) steps[names.get(hash) ?? hash] = await value
  return { result, steps }
}

describe('handleSonioxCallback steps', () => {
  test('a completed job: check, store-result, confirm-handoff, forget-at-soniox, with their saved shapes', async () => {
    const { result, steps } = await stepResults()

    expect(steps).toEqual({
      'check': { state: 'fresh' },
      'store-result': { state: 'recorded', attemptId: 'attempt-1' },
      'confirm-handoff': null,
      'forget-at-soniox': null,
    })
    expect(result).toEqual({ status: 'completed', transcriptId, jobId })
  })

  test('a failed job: record-failure saves { state, attemptId: null }', async () => {
    mockFetchTranscription.mockResolvedValue({
      raw: {},
      transcription: { ...transcription, status: 'error', error_message: 'Audio could not be decoded' },
    })

    const { result, steps } = await stepResults('error')

    expect(steps).toEqual({
      'check': { state: 'fresh' },
      'record-failure': { state: 'recorded', attemptId: null },
      'forget-at-soniox': null,
    })
    expect(result).toEqual({ status: 'error', transcriptId, jobId })
  })

  test('a resumed handoff checks as stored with its key, and stores as recorded', async () => {
    mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })

    const { steps } = await stepResults()

    expect(steps['check']).toEqual({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })
    expect(steps['store-result']).toEqual({ state: 'recorded', attemptId: 'attempt-1' })
  })

  test('a duplicate stores as recorded with no attempt, and confirms nothing', async () => {
    mockRecord.mockResolvedValue({ outcome: 'duplicate' })

    const { steps } = await stepResults()

    expect(steps).toEqual({
      'check': { state: 'fresh' },
      'store-result': { state: 'recorded', attemptId: null },
      'forget-at-soniox': null,
    })
  })

  test('an orphaned start checks as stale with another request and only forgets', async () => {
    mockReadState.mockResolvedValue({ state: 'stale', otherRequest: true })

    const { result, steps } = await stepResults()

    expect(steps).toEqual({ 'check': { state: 'stale', otherRequest: true }, 'forget-at-soniox': null })
    expect(result).toEqual({ status: 'stale', transcriptId, jobId })
  })

  test('a retry replaying a fresh check resumes from our stored copy, with the same saved shapes', async () => {
    const engine = new InngestTestEngine({ function: handleSonioxCallback })
    mockReadState.mockResolvedValue({ state: 'stored', resultObjectKey: 'user/t/job.json.gz' })

    await engine.execute({
      events: [{ name: 'soniox/callback', data: { transcriptId, jobId, requestId, status: 'completed' } }],
      steps: [{ id: 'check', handler: () => ({ state: 'fresh' }) }],
    })

    expect(mockFetchTranscription).not.toHaveBeenCalled()
    expect(mockFetchTranscript).not.toHaveBeenCalled()
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ storedObjectKey: 'user/t/job.json.gz' }))
    expect(mockDelete).toHaveBeenCalledWith(requestId)
  })

  test('a transcript gone here is forgotten', async () => {
    mockReadState.mockResolvedValue({ state: 'gone' })

    const { result } = await stepResults()

    expect(result).toEqual({ status: 'forgotten', transcriptId, jobId })
  })
})
