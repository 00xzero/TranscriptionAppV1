/** @jest-environment node */

import { transitionJob, forceJobError } from '@/lib/supabase/transition'

function createMockSupabase(rpcResult: unknown, reReadStatus?: string) {
  const singleMock = jest.fn(async () => ({
    data: reReadStatus ? { status: reReadStatus } : null,
    error: null,
  }))
  const eqMock = jest.fn(() => ({ single: singleMock }))
  const selectMock = jest.fn(() => ({ eq: eqMock }))

  return {
    client: {
      rpc: jest.fn(async () => ({ data: rpcResult, error: null })),
      from: jest.fn(() => ({
        select: selectMock,
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            in: jest.fn(async () => ({ error: null })),
          })),
        })),
      })),
    } as any,
    rpcMock: undefined as any,
  }
}

describe('transitionJob', () => {
  test('valid transition returns applied', async () => {
    const { client } = createMockSupabase({ outcome: 'applied', previous_status: 'queued' })

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'processing',
      context: 'test',
    })

    expect(result).toEqual({ outcome: 'applied', previousStatus: 'queued', error: undefined })
    expect(client.rpc).toHaveBeenCalledWith('transition_job_status', {
      p_job_id: 'job-1',
      p_to_status: 'processing',
      p_extra_fields: {},
      p_metadata: {},
      p_context: 'test',
    })
  })

  test('idempotent call (already at target) returns noop', async () => {
    const { client } = createMockSupabase({ outcome: 'noop', previous_status: 'completed' })

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'completed',
    })

    expect(result).toEqual({ outcome: 'noop', previousStatus: 'completed', error: undefined })
  })

  test('invalid transition returns invalid', async () => {
    const { client } = createMockSupabase({
      outcome: 'invalid',
      error: 'Invalid transition: completed -> queued',
      previous_status: 'completed',
    })

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'queued',
    })

    expect(result.outcome).toBe('invalid')
    expect(result.error).toContain('Invalid transition')
  })

  test('conflict + re-read at target → noop (duplicate replay)', async () => {
    const { client } = createMockSupabase(
      { outcome: 'conflict', previous_status: 'processing' },
      'completed' // re-read returns target status
    )

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'completed',
    })

    expect(result).toEqual({ outcome: 'noop', previousStatus: 'processing' })
  })

  test('conflict + re-read not at target → conflict', async () => {
    const { client } = createMockSupabase(
      { outcome: 'conflict', previous_status: 'processing' },
      'error' // re-read shows different status
    )

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'completed',
    })

    expect(result).toEqual({ outcome: 'conflict', previousStatus: 'processing' })
  })

  test('metadata and context passed through to RPC', async () => {
    const { client } = createMockSupabase({ outcome: 'applied', previous_status: 'processing' })

    await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'completed',
      metadata: { chunkCount: 5 },
      context: 'handleTranscriptionCompleted',
      extraJobFields: { finished_at: '2026-01-01T00:00:00Z' },
    })

    expect(client.rpc).toHaveBeenCalledWith('transition_job_status', {
      p_job_id: 'job-1',
      p_to_status: 'completed',
      p_extra_fields: { finished_at: '2026-01-01T00:00:00Z' },
      p_metadata: { chunkCount: 5 },
      p_context: 'handleTranscriptionCompleted',
    })
  })

  test('RPC error returns invalid with message', async () => {
    const client = {
      rpc: jest.fn(async () => ({ data: null, error: { message: 'RPC failed' } })),
      from: jest.fn(),
    } as any

    const result = await transitionJob({
      supabase: client,
      jobId: 'job-1',
      to: 'processing',
    })

    expect(result).toEqual({ outcome: 'invalid', error: 'RPC failed' })
  })
})

describe('forceJobError', () => {
  test('updates with WHERE status IN (queued, processing)', async () => {
    const inMock = jest.fn(async () => ({ error: null }))
    const eqMock = jest.fn(() => ({ in: inMock }))
    const updateMock = jest.fn(() => ({ eq: eqMock }))
    const client = {
      from: jest.fn(() => ({ update: updateMock })),
    } as any

    await forceJobError({
      supabase: client,
      jobId: 'job-1',
      extraJobFields: { payload: { error: 'timeout' } },
      context: 'test',
    })

    expect(client.from).toHaveBeenCalledWith('jobs')
    expect(updateMock).toHaveBeenCalled()
    const [updateArg] = updateMock.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(updateArg.status).toBe('error')
    expect(updateArg.payload).toEqual({ error: 'timeout' })
    expect(eqMock).toHaveBeenCalledWith('id', 'job-1')
    expect(inMock).toHaveBeenCalledWith('status', ['queued', 'processing'])
  })

  test('never throws even on error', async () => {
    const client = {
      from: jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            in: jest.fn(async () => ({ error: { message: 'db error' } })),
          })),
        })),
      })),
    } as any

    // Should not throw
    await expect(
      forceJobError({ supabase: client, jobId: 'job-1', context: 'test' })
    ).resolves.toBeUndefined()
  })

  test('does not overwrite completed jobs (WHERE clause guards)', async () => {
    const inMock = jest.fn(async () => ({ error: null }))
    const eqMock = jest.fn(() => ({ in: inMock }))
    const updateMock = jest.fn(() => ({ eq: eqMock }))
    const client = {
      from: jest.fn(() => ({ update: updateMock })),
    } as any

    await forceJobError({ supabase: client, jobId: 'job-1' })

    // Verify the IN clause excludes completed/error
    expect(inMock).toHaveBeenCalledWith('status', ['queued', 'processing'])
  })
})
