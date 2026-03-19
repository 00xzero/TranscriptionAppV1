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

jest.mock('@/lib/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: (table: string) => {
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

describe('Deepgram webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    maybeSingleMock.mockReset()
    selectMock.mockClear()
    mockForceJobError.mockClear()
    insertMock.mockClear()
    process.env.DEEPGRAM_API_KEY_IDENTIFIER = 'test-token'
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
})
