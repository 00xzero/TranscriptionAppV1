/** @jest-environment node */

import { POST } from '../app/api/webhooks/deepgram/route'

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
const maybeSingleMock = jest.fn()
const selectChain = {
  eq: jest.fn(() => selectChain),
  in: jest.fn(() => selectChain),
  order: jest.fn(() => selectChain),
  limit: jest.fn(() => selectChain),
  maybeSingle: maybeSingleMock,
}
const selectMock = jest.fn(() => selectChain)

jest.mock('@/lib/supabase/admin', () => {
  return {
    createAdminClient: () => ({
      from: () => ({
        select: selectMock,
        update: updateMock,
      }),
    }),
  }
})

describe('Deepgram webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    maybeSingleMock.mockReset()
    selectMock.mockClear()
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

  test('marks job as error when project_id is missing', async () => {
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

    expect(updateMock).toHaveBeenCalled()
    expect(updateEqMock).toHaveBeenCalledWith('id', 'job-1')
  })
})
