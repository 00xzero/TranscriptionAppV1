/** @jest-environment node */

/**
 * A callback that names its exact job attempt (Soniox's) acts on that attempt
 * only: never on a newer one, never after it failed, and its checks hold in the
 * write itself, not just in a read before it.
 */

const mockUpload = jest.fn(async () => undefined)
const mockRemove = jest.fn(async () => undefined)
const mockSend = jest.fn(async () => ({ ids: ['evt'] }))

jest.mock('@/infra/supabase/transcription-results.server', () => ({
  uploadTranscriptionResult: (...a: unknown[]) => mockUpload(...(a as [])),
  removeTranscriptionResult: (...a: unknown[]) => mockRemove(...(a as [])),
}))
jest.mock('@/infra/inngest/client', () => ({
  sendInngestEvent: (...a: unknown[]) => mockSend(...(a as [])),
}))

import { confirmReceiptCompleted, persistWebhookFailure, recordEngineResult } from '@/core/transcription/webhook'
import { readEngineCallbackState, engineHandoffState } from '@/lib/inngest/engine-callback-state'
import { FakeAdmin, type Row } from './helpers/fakeAdmin'

const userId = '22222222-2222-4222-8222-222222222222'
const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobA = '33333333-3333-4333-8333-33333333333a'
const jobB = '33333333-3333-4333-8333-33333333333b'
const requestA = 'aaaaaaaa-0000-4000-8000-00000000000a'
const requestB = 'bbbbbbbb-0000-4000-8000-00000000000b'

function setup(jobs: Array<Partial<Row> & { id: string }>) {
  const db = new FakeAdmin()
  db.tables.transcripts.push({ id: transcriptId, user_id: userId })
  for (const job of jobs) {
    db.tables.jobs.push({
      transcript_id: transcriptId,
      status: 'processing',
      inngest_event_id: null,
      result_object_key: null,
      ...job,
    })
  }
  return db
}

const job = (db: FakeAdmin, id: string) => db.rows('jobs').find((row) => row.id === id)!

function record(db: FakeAdmin, overrides: { jobId?: string; requestId?: string } = {}) {
  return recordEngineResult({
    supabase: db.asClient(),
    engine: 'soniox',
    transcriptId,
    jobId: overrides.jobId ?? jobA,
    requestId: overrides.requestId ?? requestA,
    rawBody: '{"result":true}',
  })
}

function fail(db: FakeAdmin, overrides: { jobId?: string; requestId?: string } = {}) {
  return persistWebhookFailure({
    supabase: db.asClient(),
    engine: 'soniox',
    transcriptId,
    jobId: overrides.jobId ?? jobA,
    requestId: overrides.requestId ?? requestA,
    message: 'Transcription failed: audio unreadable',
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recordEngineResult with an exact job', () => {
  test('stores, links and hands off a processing attempt, then completes its receipt', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])

    await expect(record(db)).resolves.toEqual(expect.objectContaining({ outcome: 'processed' }))

    expect(mockUpload).toHaveBeenCalledWith(expect.anything(), `${userId}/${transcriptId}/${jobA}.json.gz`, '{"result":true}')
    expect(job(db, jobA)).toEqual(expect.objectContaining({ result_object_key: `${userId}/${transcriptId}/${jobA}.json.gz` }))
    expect(mockSend).toHaveBeenCalledWith({ name: 'transcription/webhook', data: { requestId: requestA, transcriptId } })
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ provider: 'soniox', request_id: requestA, status: 'completed' })])
  })

  test('saves the request id on an attempt that has none yet', async () => {
    const db = setup([{ id: jobA }])

    await expect(record(db)).resolves.toEqual(expect.objectContaining({ outcome: 'processed' }))
    expect(job(db, jobA).inngest_event_id).toBe(requestA)
  })

  test('asks to retry while the attempt is still queued, writing nothing', async () => {
    const db = setup([{ id: jobA, status: 'queued' }])

    await expect(record(db)).resolves.toEqual({ outcome: 'retrying', retryAfter: 30 })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(db.rows('webhook_receipts')).toEqual([])
  })

  test('a completed attempt is a duplicate', async () => {
    const db = setup([{ id: jobA, status: 'completed', inngest_event_id: requestA }])

    await expect(record(db)).resolves.toEqual({ outcome: 'duplicate' })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test.each([
    ['failed', { status: 'error', inngest_event_id: requestA }],
    ['for another request', { inngest_event_id: requestB }],
  ])('an attempt that %s is stale and untouched', async (_label, state) => {
    const db = setup([{ id: jobA, ...state }])

    await expect(record(db)).resolves.toEqual({ outcome: 'stale' })
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a result for attempt A never lands on a newer attempt B', async () => {
    const db = setup([
      { id: jobA, status: 'error', inngest_event_id: requestA },
      { id: jobB, inngest_event_id: requestB },
    ])

    await expect(record(db)).resolves.toEqual({ outcome: 'stale' })
    expect(job(db, jobB)).toEqual(expect.objectContaining({ status: 'processing', result_object_key: null }))
  })

  test('a transcript deleted during the upload loses the file its delete could not sweep', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockUpload.mockImplementationOnce(async () => {
      db.tables.transcripts.length = 0
      db.tables.jobs.length = 0
    })

    await expect(record(db)).resolves.toEqual({ outcome: 'stale' })
    expect(mockRemove).toHaveBeenCalledWith(expect.anything(), `${userId}/${transcriptId}/${jobA}.json.gz`, 'recordEngineResult')
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('a failed removal of that file is logged, not thrown, since no retry could find it', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockUpload.mockImplementationOnce(async () => {
      db.tables.transcripts.length = 0
      db.tables.jobs.length = 0
    })
    mockRemove.mockImplementationOnce(async () => {
      throw new Error('storage down')
    })
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(record(db)).resolves.toEqual({ outcome: 'stale' })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(`${jobA}.json.gz may be left behind`), 'storage down')
    logged.mockRestore()
  })

  test('the link holds its checks itself: an attempt that failed during the upload is not linked, and its file is kept', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockUpload.mockImplementationOnce(async () => {
      job(db, jobA).status = 'error'
    })

    await expect(record(db)).resolves.toEqual({ outcome: 'stale' })
    expect(job(db, jobA).result_object_key).toBeNull()
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'failed' })])
  })

  test('a receipt held by another attempt (one killed mid-step) says how long its lease has left', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    db.tables.webhook_receipts.push({
      provider: 'soniox',
      request_id: requestA,
      status: 'processing',
      attempt_id: 'killed-attempt',
      claimed_at: new Date(Date.now() - 60_000).toISOString(),
    })

    const result = await record(db)

    expect(result).toEqual(expect.objectContaining({ outcome: 'retrying', retryAfter: 30 }))
    const remaining = (result as { leaseRemainingMs?: number }).leaseRemainingMs ?? 0
    expect(remaining).toBeGreaterThan(235_000)
    expect(remaining).toBeLessThanOrEqual(240_000)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('a refused link whose job then cannot be read is retried, not given up: the receipt is released first', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockUpload.mockImplementationOnce(async () => {
      // The link is refused, and the read that would explain why fails.
      job(db, jobA).status = 'queued'
      db.failingReads.add('jobs')
    })

    await expect(record(db)).resolves.toEqual({ outcome: 'retrying', retryAfter: 30 })
    expect(job(db, jobA).result_object_key).toBeNull()
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'failed' })])

    // The retry takes the released receipt over at once and completes.
    job(db, jobA).status = 'processing'
    db.failingReads.delete('jobs')
    await expect(record(db)).resolves.toEqual(expect.objectContaining({ outcome: 'processed' }))
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'completed' })])
  })

  test('a refused link on a job that went back to queued is retried too', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockUpload.mockImplementationOnce(async () => {
      job(db, jobA).status = 'queued'
    })

    await expect(record(db)).resolves.toEqual({ outcome: 'retrying', retryAfter: 30 })
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'failed' })])
  })

  test('a failed hand-off leaves the file linked and the receipt failed; the retry overwrites the same file and completes', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    mockSend.mockRejectedValueOnce(new Error('send failed'))

    await expect(record(db)).rejects.toThrow('send failed')
    expect(job(db, jobA).result_object_key).toBe(`${userId}/${transcriptId}/${jobA}.json.gz`)
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'failed' })])

    await expect(record(db)).resolves.toEqual(expect.objectContaining({ outcome: 'processed' }))
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls[1]).toEqual(mockUpload.mock.calls[0])
    expect(db.rows('webhook_receipts')).toEqual([expect.objectContaining({ status: 'completed' })])
  })
})

describe('persistWebhookFailure with an exact job', () => {
  test('fails the processing attempt it names', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])

    await expect(fail(db)).resolves.toBe('job')
    expect(job(db, jobA)).toEqual(expect.objectContaining({
      status: 'error',
      error_message: 'Transcription failed: audio unreadable',
      error_type: 'transcription_error',
    }))
  })

  test('a late failure for attempt A leaves the newer attempt B untouched', async () => {
    const db = setup([
      { id: jobA, status: 'error', inngest_event_id: requestA },
      { id: jobB, inngest_event_id: requestB },
    ])

    await expect(fail(db)).resolves.toBe('stale')
    expect(job(db, jobB).status).toBe('processing')
  })

  test('asks to retry while the attempt is still queued', async () => {
    const db = setup([{ id: jobA, status: 'queued' }])

    await expect(fail(db)).resolves.toBe('nothing')
    expect(job(db, jobA).status).toBe('queued')
  })

  test('a failure for another request is stale', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestB }])

    await expect(fail(db)).resolves.toBe('stale')
    expect(job(db, jobA).status).toBe('processing')
  })
})

describe('readEngineCallbackState', () => {
  const read = (db: FakeAdmin) => readEngineCallbackState(db.asClient(), 'soniox', { transcriptId, jobId: jobA, requestId: requestA })
  const receipt = (status: string) => ({ provider: 'soniox', request_id: requestA, status })

  test('nothing recorded yet: fresh', async () => {
    await expect(read(setup([{ id: jobA, inngest_event_id: requestA }]))).resolves.toEqual({ state: 'fresh' })
  })

  test('the transcript was deleted: gone', async () => {
    const db = new FakeAdmin()
    await expect(read(db)).resolves.toEqual({ state: 'gone' })
  })

  test('a completed receipt, or a completed job: handled', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA, result_object_key: 'key' }])
    db.tables.webhook_receipts.push(receipt('completed'))
    await expect(read(db)).resolves.toEqual({ state: 'handled' })

    await expect(read(setup([{ id: jobA, status: 'completed', inngest_event_id: requestA }]))).resolves.toEqual({ state: 'handled' })
  })

  test('a linked file whose hand-off failed is not handled: resume from it', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA, result_object_key: 'key' }])
    db.tables.webhook_receipts.push(receipt('failed'))
    await expect(read(db)).resolves.toEqual({ state: 'stored', resultObjectKey: 'key' })
  })

  test('a failed attempt, or another request: stale, and only another request is an orphaned start', async () => {
    await expect(read(setup([{ id: jobA, status: 'error', inngest_event_id: requestA }])))
      .resolves.toEqual({ state: 'stale', otherRequest: false })
    await expect(read(setup([{ id: jobA, inngest_event_id: requestB }])))
      .resolves.toEqual({ state: 'stale', otherRequest: true })
    // A failed job that another request had replaced is still an orphaned start.
    await expect(read(setup([{ id: jobA, status: 'error', inngest_event_id: requestB }])))
      .resolves.toEqual({ state: 'stale', otherRequest: true })
  })

  test('still queued: not ready', async () => {
    await expect(read(setup([{ id: jobA, status: 'queued' }]))).resolves.toEqual({ state: 'not_ready' })
  })
})

describe('engineHandoffState', () => {
  const read = (db: FakeAdmin) => engineHandoffState(db.asClient(), 'soniox', { jobId: jobA, requestId: requestA })

  test('an active job without a completed receipt was not handed off', async () => {
    await expect(read(setup([{ id: jobA, inngest_event_id: requestA }]))).resolves.toEqual({ handedOff: false, resultLinked: false, jobExists: true })
  })

  test('a completed receipt means only cleanup is left, even while the job still processes', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA }])
    db.tables.webhook_receipts.push({ provider: 'soniox', request_id: requestA, status: 'completed' })
    await expect(read(db)).resolves.toEqual({ handedOff: true, resultLinked: false, jobExists: true })
  })

  test('a linked result whose receipt never completed is unconfirmed, not failed', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestA, result_object_key: 'key' }])
    db.tables.webhook_receipts.push({ provider: 'soniox', request_id: requestA, status: 'processing' })
    await expect(read(db)).resolves.toEqual({ handedOff: false, resultLinked: true, jobExists: true })
  })

  test('an unreadable state throws rather than guess', async () => {
    const db = setup([{ id: jobA }])
    const client = db.asClient()
    const broken = { from: (table: string) => (table === 'jobs'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }
      : client.from(table)) }
    await expect(engineHandoffState(broken as never, 'soniox', { jobId: jobA, requestId: requestA })).rejects.toThrow('db down')
  })

  test('a job running another request (this callback was an orphaned start) is not this callback\'s to fail', async () => {
    const db = setup([{ id: jobA, inngest_event_id: requestB, result_object_key: 'key-b' }])
    await expect(read(db)).resolves.toEqual({ handedOff: true, resultLinked: false, jobExists: true })
    const fresh = setup([{ id: jobA, inngest_event_id: requestB }])
    await expect(read(fresh)).resolves.toEqual({ handedOff: true, resultLinked: false, jobExists: true })
  })

  test('a finished or deleted job has nothing left to fail', async () => {
    await expect(read(setup([{ id: jobA, status: 'error' }]))).resolves.toEqual({ handedOff: true, resultLinked: false, jobExists: true })
    await expect(read(new FakeAdmin())).resolves.toEqual({ handedOff: true, resultLinked: false, jobExists: false })
  })
})

describe('confirmReceiptCompleted', () => {
  const confirm = (db: FakeAdmin, attemptId: string) => confirmReceiptCompleted(db.asClient(), 'soniox', requestA, attemptId)
  const receipt = (status: string, attempt_id: string) => ({ provider: 'soniox', request_id: requestA, status, attempt_id })

  test('completes the receipt its own attempt holds', async () => {
    const db = new FakeAdmin()
    db.tables.webhook_receipts.push(receipt('processing', 'attempt-1'))
    await expect(confirm(db, 'attempt-1')).resolves.toBe(true)
    expect(db.rows('webhook_receipts')[0].status).toBe('completed')
  })

  test('a receipt another attempt completed counts', async () => {
    const db = new FakeAdmin()
    db.tables.webhook_receipts.push(receipt('completed', 'attempt-2'))
    await expect(confirm(db, 'attempt-1')).resolves.toBe(true)
  })

  test('a receipt another attempt still holds does not', async () => {
    const db = new FakeAdmin()
    db.tables.webhook_receipts.push(receipt('processing', 'attempt-2'))
    await expect(confirm(db, 'attempt-1')).resolves.toBe(false)
  })

  test('a write that fails throws, so the step retries', async () => {
    const db = new FakeAdmin()
    db.tables.webhook_receipts.push(receipt('processing', 'attempt-1'))
    db.failingUpdates.add('webhook_receipts')
    await expect(confirm(db, 'attempt-1')).rejects.toThrow('Failed to complete receipt')
  })
})
