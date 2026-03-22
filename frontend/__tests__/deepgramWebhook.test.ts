/** @jest-environment node */

jest.mock('@/lib/supabase/transition', () => ({
  transitionJob: jest.fn(),
  forceJobError: jest.fn(async () => undefined),
}))

import { POST } from '../app/api/webhooks/deepgram/route'
import { forceJobError } from '@/lib/supabase/transition'

jest.mock('@/lib/inngest/client', () => {
  return {
    inngest: {
      send: jest.fn(async () => undefined),
    },
  }
})

const updateEqMock = jest.fn(async (_column: string, _value: string) => ({ error: null }))
const updateMock = jest.fn((_values: unknown) => ({
  eq: updateEqMock,
}))
const insertMock = jest.fn(async () => ({ error: null }))
const maybeSingleMock = jest.fn()
const selectChain: any = {
  eq: jest.fn(() => selectChain),
  in: jest.fn(() => selectChain),
  order: jest.fn(() => selectChain),
  limit: jest.fn(() => selectChain),
  maybeSingle: maybeSingleMock,
}
const selectMock = jest.fn(() => selectChain)
const mockForceJobError = forceJobError as jest.MockedFunction<typeof forceJobError>

// Thenable chain for receipt updates — supports .eq()/.neq()/.select() chaining;
// the chain itself is awaitable and delegates to receiptUpdateTerminal
const receiptUpdateTerminal = jest.fn(async () => ({ data: null, error: null }))
const receiptUpdateChain: any = {
  eq:     jest.fn(() => receiptUpdateChain),
  neq:    jest.fn(() => receiptUpdateChain),
  select: jest.fn(() => receiptUpdateChain),
  then:   (resolve: any, reject: any) => receiptUpdateTerminal().then(resolve, reject),
}
const receiptUpdateMock = jest.fn(() => receiptUpdateChain)

const receiptInsertMock = jest.fn(async () => ({ error: null }))

const receiptSingleMock = jest.fn()
const receiptSelectChain: any = {
  eq:     jest.fn(() => receiptSelectChain),
  single: receiptSingleMock,
}
const receiptSelectMock = jest.fn(() => receiptSelectChain)

jest.mock('@/lib/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table === 'webhook_receipts') {
          return {
            insert: receiptInsertMock,
            update: receiptUpdateMock,
            select: receiptSelectMock,
          }
        }
        if (table === 'failed_events') {
          return { insert: insertMock }
        }
        return {
          select: selectMock,
          update: updateMock,
        }
      },
    }),
  }
})

function makeRequest(requestId: string, projectId: string) {
  return {
    headers: new Headers({ 'dg-token': 'test-token' }),
    json: async () => ({
      metadata: { request_id: requestId, extra: { project_id: projectId } },
      results: { channels: [] },
    }),
  } as any
}

describe('Deepgram webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    maybeSingleMock.mockReset()
    selectMock.mockClear()
    mockForceJobError.mockClear()
    insertMock.mockClear()
    process.env.DEEPGRAM_API_KEY_IDENTIFIER = 'test-token'

    receiptInsertMock.mockReset()
    receiptInsertMock.mockResolvedValue({ error: null })
    receiptUpdateTerminal.mockReset()
    receiptUpdateTerminal.mockResolvedValue({ data: null, error: null })
    receiptSingleMock.mockReset()
  })

  test('persists payload and sends minimal Inngest event', async () => {
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })

    const payload = {
      metadata: {
        request_id: 'req-123',
        extra: {
          project_id: 'proj-456',
        },
      },
      results: {
        channels: [],
      },
    }

    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      json: async () => payload,
    } as any

    const res = await POST(request)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json).toEqual({ received: true })

    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      payload: { deepgram: payload },
      inngest_event_id: 'req-123',
    })

    expect(updateEqMock).toHaveBeenCalledTimes(1)
    expect(updateEqMock).toHaveBeenCalledWith('id', 'job-1')

    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).toHaveBeenCalledTimes(1)
    expect((inngest.send as jest.Mock).mock.calls[0][0]).toEqual({
      name: 'transcription/webhook',
      data: {
        requestId: 'req-123',
        projectId: 'proj-456',
      },
    })
  })

  test('rejects when dg-token is missing', async () => {
    const request = {
      headers: new Headers({}),
      json: async () => ({}),
    } as any

    const res = await POST(request)
    expect(res.status).toBe(401)

    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    expect(updateEqMock).not.toHaveBeenCalled()
  })

  test('calls forceJobError when project_id missing but job found via requestId', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: 'job-1', project_id: 'proj-456' },
      error: null,
    })

    const payload = {
      metadata: {
        request_id: 'req-123',
        extra: {},
      },
      results: {
        channels: [],
      },
    }

    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      json: async () => payload,
    } as any

    const res = await POST(request)
    expect(res.status).toBe(400)

    expect(mockForceJobError).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        context: 'persistWebhookFailure',
      })
    )
  })

  test('marks project as error and logs failed_event when project is known but no job is found', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: null,
    })

    const payload = {
      metadata: {
        extra: {
          project_id: 'proj-456',
        },
      },
      results: {
        channels: [],
      },
    }

    const request = {
      headers: new Headers({ 'dg-token': 'test-token' }),
      json: async () => payload,
    } as any

    const res = await POST(request)
    expect(res.status).toBe(400)

    expect(insertMock).toHaveBeenCalledWith({
      event_name: 'deepgram/webhook_failure',
      event_data: { projectId: 'proj-456', requestId: undefined },
      error_message: 'Deepgram webhook missing project_id or request_id.',
      project_id: 'proj-456',
    })
    expect(updateMock).toHaveBeenCalledWith({ status: 'error' })
    expect(updateEqMock).toHaveBeenCalledWith('id', 'proj-456')
    expect(mockForceJobError).not.toHaveBeenCalled()
  })

  // --- Idempotency guard tests ---

  test('returns 200 no-op when receipt is completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'completed', attempt_id: 'old-id', claimed_at: new Date().toISOString() },
      error: null,
    })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 503 when receipt is processing and fresh', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'processing', attempt_id: 'owner-id', claimed_at: new Date().toISOString() },
      error: null,
    })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(503)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('takes over and processes when receipt is processing but stale', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      // claimed_at is 6 minutes ago — past the 5-minute RECEIPT_LEASE_MS
      data: { status: 'processing', attempt_id: 'stale-id', claimed_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
      error: null,
    })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null }) // takeover wins
      .mockResolvedValueOnce({ data: null, error: null })             // finalize success
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(1)
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).toHaveBeenCalledTimes(1)
  })

  test('returns 500 when receipt status read fails', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(500)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('takes over and processes when receipt is failed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
      error: null,
    })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null }) // takeover wins
      .mockResolvedValueOnce({ data: null, error: null })             // finalize success
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(1) // job update
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).toHaveBeenCalledTimes(1)
  })

  test('returns 500 when takeover update errors', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock.mockResolvedValueOnce({
      data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
      error: null,
    })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(500)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 503 when takeover loses and re-read is not completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock
      .mockResolvedValueOnce({
        data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
        error: null,
      })
      // Re-read after 0 rows: still processing (race winner not done yet)
      .mockResolvedValueOnce({ data: { status: 'processing' }, error: null })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(503)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('returns 200 when takeover loses but re-read shows completed', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } })
    receiptSingleMock
      .mockResolvedValueOnce({
        data: { status: 'failed', attempt_id: 'dead-id', claimed_at: new Date(0).toISOString() },
        error: null,
      })
      // Re-read after 0 rows: race winner already finished
      .mockResolvedValueOnce({ data: { status: 'completed' }, error: null })
    receiptUpdateTerminal.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(200)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })

  test('marks receipt failed (scoped by attempt_id) when downstream work throws', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: null })
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'DB timeout' } })

    const res = await POST(makeRequest('req-fail', 'proj-456'))

    expect(res.status).toBe(500)
    expect(receiptUpdateTerminal).toHaveBeenCalled()
    const lastUpdateArgs = receiptUpdateMock.mock.calls.at(-1)
    expect(lastUpdateArgs?.[0]).toMatchObject({ status: 'failed' })
  })

  test('returns 200 and leaves receipt processing when finalize update fails', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: null })
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'job-1' }, error: null })
    receiptUpdateTerminal
      .mockResolvedValueOnce({ data: null, error: { message: 'finalize failed' } }) // finalize fails

    const res = await POST(makeRequest('req-123', 'proj-456'))

    // Real work was done — still return 200
    expect(res.status).toBe(200)
    // Only the failed finalize attempt — no mark-failed call
    expect(receiptUpdateTerminal).toHaveBeenCalledTimes(1)
  })

  test('returns 503 when receipt insert fails with non-conflict error', async () => {
    receiptInsertMock.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } })

    const res = await POST(makeRequest('req-123', 'proj-456'))

    expect(res.status).toBe(503)
    expect(updateMock).not.toHaveBeenCalled()
    const { inngest } = await import('@/lib/inngest/client')
    expect(inngest.send).not.toHaveBeenCalled()
  })
})
