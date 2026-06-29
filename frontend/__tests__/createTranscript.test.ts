/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/infra/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}))

import { POST } from '../app/api/transcripts/route'

function makeTranscriptInsertChain(transcriptData: unknown) {
  const singleMock = jest.fn(async () => ({ data: transcriptData, error: null }))
  const selectMock = jest.fn(() => ({ single: singleMock }))
  const insertMock = jest.fn(() => ({ select: selectMock }))
  return { insert: insertMock }
}

describe('POST /api/transcripts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    })
  })

  test('missing filename returns 400', async () => {
    const req = { json: async () => ({ title: 'test' }) } as any

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  test('empty filename returns 400', async () => {
    const req = { json: async () => ({ filename: '' }) } as any

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  test('valid body returns 200 with transcript and storagePath', async () => {
    const transcriptData = {
      id: '00000000-0000-0000-0000-000000000002',
      status: 'created',
      title: 'audio.mp3',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    fromMock.mockImplementation((table: string) => {
      if (table === 'transcripts') return makeTranscriptInsertChain(transcriptData)
      if (table === 'watchlist') return { insert: jest.fn(async () => ({ error: null })) }
      return {}
    })

    const req = { json: async () => ({ filename: 'audio.mp3' }) } as any

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.transcript).toBeDefined()
    expect(json.storagePath).toContain('audio.mp3')
  })
})
