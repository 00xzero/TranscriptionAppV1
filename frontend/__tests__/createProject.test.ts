/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}))

import { POST } from '../app/api/projects/route'

function makeProjectInsertChain(projectData: unknown) {
  const singleMock = jest.fn(async () => ({ data: projectData, error: null }))
  const selectMock = jest.fn(() => ({ single: singleMock }))
  const insertMock = jest.fn(() => ({ select: selectMock }))
  return { insert: insertMock }
}

describe('POST /api/projects', () => {
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

  test('valid body returns 200 with project and storagePath', async () => {
    const projectData = {
      id: '00000000-0000-0000-0000-000000000002',
      status: 'created',
      title: 'audio.mp3',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    fromMock.mockImplementation((table: string) => {
      if (table === 'projects') return makeProjectInsertChain(projectData)
      if (table === 'watchlist') return { insert: jest.fn(async () => ({ error: null })) }
      return {}
    })

    const req = { json: async () => ({ filename: 'audio.mp3' }) } as any

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.project).toBeDefined()
    expect(json.storagePath).toContain('audio.mp3')
  })
})
