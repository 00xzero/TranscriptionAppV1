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

const PROJECT_ID = '00000000-0000-0000-0000-000000000003'
const INTENT_BODY = {
  filename: 'audio.mp3',
  upload_intent_id: 'intent-1',
  project_id: PROJECT_ID,
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    status: 'created',
    title: 'audio.mp3',
    project_id: null,
    source_object_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTranscriptTable(options: {
  insertResults: Array<{ data: unknown; error: null | { code?: string; message: string } }>
  existingResults?: unknown[]
}) {
  const singleMock = jest.fn()
  for (const result of options.insertResults) singleMock.mockResolvedValueOnce(result)
  const selectMock = jest.fn(() => ({ single: singleMock }))
  const insertMock = jest.fn(() => ({ select: selectMock }))
  const maybeSingleMock = jest.fn()
  for (const data of options.existingResults ?? []) {
    maybeSingleMock.mockResolvedValueOnce({ data, error: null })
  }
  const existingEqUploadIntentMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }))
  const existingEqUserMock = jest.fn(() => ({ eq: existingEqUploadIntentMock }))
  const existingSelectMock = jest.fn(() => ({ eq: existingEqUserMock }))
  return {
    insert: insertMock,
    select: existingSelectMock,
    insertMock,
  }
}

/** Route `from()` to the transcript table mock (plus a no-op watchlist) and POST the body. */
function postTranscript(
  transcripts: ReturnType<typeof makeTranscriptTable>,
  body: Record<string, unknown>
) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'transcripts') return transcripts
    if (table === 'watchlist') return { insert: jest.fn(async () => ({ error: null })) }
    return {}
  })
  return POST({ json: async () => body } as unknown as Parameters<typeof POST>[0])
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
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    const res = await postTranscript(transcripts, { filename: 'audio.mp3' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.transcript).toBeDefined()
    expect(json.storagePath).toContain('audio.mp3')
  })

  test.each(['PJ001', 'PJ002', '23503'])(
    'falls back to Unfiled when project insert fails with %s',
    async (code) => {
      const transcripts = makeTranscriptTable({
        insertResults: [
          { data: null, error: { code, message: 'project unavailable' } },
          { data: makeRow(), error: null },
        ],
      })

      const res = await postTranscript(transcripts, { filename: 'audio.mp3', project_id: PROJECT_ID })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ warning: 'project_missing' })
      expect(transcripts.insertMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ project_id: PROJECT_ID })
      )
      expect(transcripts.insertMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ project_id: null })
      )
    }
  )

  test('preserves upload-intent dedupe when the Unfiled retry loses a race', async () => {
    const raced = makeRow()
    const transcripts = makeTranscriptTable({
      existingResults: [null, raced],
      insertResults: [
        { data: null, error: { code: 'PJ002', message: 'project deleting' } },
        { data: null, error: { code: '23505', message: 'duplicate intent' } },
      ],
    })

    const res = await postTranscript(transcripts, INTENT_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      deduped: true,
      warning: 'project_missing',
      transcript: { id: raced.id },
    })
  })

  test('restores the Unfiled warning when a retry finds the canonical row up front', async () => {
    const existing = makeRow({ source_object_key: 'user/transcript/audio.mp3' })
    const transcripts = makeTranscriptTable({
      existingResults: [existing],
      insertResults: [],
    })

    const res = await postTranscript(transcripts, INTENT_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      deduped: true,
      warning: 'project_missing',
      transcript: { id: existing.id },
    })
    expect(transcripts.insertMock).not.toHaveBeenCalled()
  })

  test('does not claim Unfiled when a fallback race resolves to the requested project', async () => {
    const transcripts = makeTranscriptTable({
      existingResults: [null, makeRow({ project_id: PROJECT_ID })],
      insertResults: [
        { data: null, error: { code: 'PJ002', message: 'project deleting' } },
        { data: null, error: { code: '23505', message: 'duplicate intent' } },
      ],
    })

    const res = await postTranscript(transcripts, INTENT_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.not.objectContaining({ warning: expect.anything() }))
  })

  test('does not retry unrelated insert failures', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [
        { data: null, error: { code: 'XX000', message: 'database unavailable' } },
      ],
    })

    const res = await postTranscript(transcripts, { filename: 'audio.mp3', project_id: PROJECT_ID })
    expect(res.status).toBe(500)
    expect(transcripts.insertMock).toHaveBeenCalledTimes(1)
  })
})
