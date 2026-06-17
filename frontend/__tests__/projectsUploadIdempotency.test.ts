/** @jest-environment node */

const getUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/infra/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}))

import { POST } from '../app/api/projects/route'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const INTENT = 'intent-abc'

interface QueryResult {
  data: unknown
  error: unknown
}

// A single shared `projects` builder. The dedup pre-check and the 23505 re-read
// both use `.select(cols).eq().eq().maybeSingle()`, so maybeSingle results are
// drained from a queue; the insert path uses `.insert().select().single()`.
function makeProjectsBuilder(opts: {
  maybeSingleQueue: QueryResult[]
  insertResult: QueryResult
}) {
  const maybeSingle = jest.fn(
    async () => opts.maybeSingleQueue.shift() ?? { data: null, error: null }
  )
  const select = jest.fn(() => ({
    eq: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
  }))
  const single = jest.fn(async () => opts.insertResult)
  const insert = jest.fn(() => ({ select: jest.fn(() => ({ single })) }))
  return { select, insert, spies: { select, insert, single, maybeSingle } }
}

const canonicalRow = {
  id: '00000000-0000-0000-0000-0000000000aa',
  status: 'created',
  title: 'audio.webm',
  source_object_key: null,
  created_at: '2026-06-15T00:00:00Z',
  updated_at: '2026-06-15T00:00:00Z',
}

function installProjects(builder: { select: unknown; insert: unknown }) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'projects') return builder
    if (table === 'watchlist') return { insert: jest.fn(async () => ({ error: null })) }
    return {}
  })
}

describe('POST /api/projects upload-intent idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    })
  })

  test('pre-check hit returns the canonical project without inserting', async () => {
    const builder = makeProjectsBuilder({
      maybeSingleQueue: [{ data: canonicalRow, error: null }],
      insertResult: { data: null, error: null },
    })
    installProjects(builder)

    const req = {
      json: async () => ({ filename: 'audio.webm', upload_intent_id: INTENT }),
    } as any

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.project.id).toBe(canonicalRow.id)
    expect(json.deduped).toBe(true)
    expect(builder.spies.insert).not.toHaveBeenCalled()
  })

  test('fresh create inserts with the intent id and is not deduped', async () => {
    const builder = makeProjectsBuilder({
      maybeSingleQueue: [{ data: null, error: null }],
      insertResult: { data: canonicalRow, error: null },
    })
    installProjects(builder)

    const req = {
      json: async () => ({ filename: 'audio.webm', upload_intent_id: INTENT }),
    } as any

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deduped).toBe(false)
    expect(json.project.id).toBe(canonicalRow.id)
    expect(builder.spies.insert).toHaveBeenCalledTimes(1)
  })

  test('a 23505 race re-reads and returns the canonical project', async () => {
    const builder = makeProjectsBuilder({
      // pre-check miss, then the post-23505 re-read hits the canonical row.
      maybeSingleQueue: [
        { data: null, error: null },
        { data: canonicalRow, error: null },
      ],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    installProjects(builder)

    const req = {
      json: async () => ({ filename: 'audio.webm', upload_intent_id: INTENT }),
    } as any

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deduped).toBe(true)
    expect(json.project.id).toBe(canonicalRow.id)
  })

  test('a 23505 with no canonical row surfaces the original error (500)', async () => {
    const builder = makeProjectsBuilder({
      maybeSingleQueue: [
        { data: null, error: null }, // pre-check miss
        { data: null, error: null }, // re-read finds nothing → rethrow
      ],
      insertResult: { data: null, error: { code: '23505', message: 'some other unique' } },
    })
    installProjects(builder)

    const req = {
      json: async () => ({ filename: 'audio.webm', upload_intent_id: INTENT }),
    } as any

    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
