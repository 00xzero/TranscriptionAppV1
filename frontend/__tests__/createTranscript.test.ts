/** @jest-environment node */

const getCurrentUserMock = jest.fn()
const fromMock = jest.fn()

jest.mock('@/lib/auth/current-user.server', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

jest.mock('@/infra/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    [Symbol.asyncDispose]: async () => {},
    from: fromMock,
  })),
}))

import { POST } from '../app/api/transcripts/route'
import { EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'

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
  return POST({ headers: new Headers({ [EXPECTED_USER_HEADER]: '00000000-0000-0000-0000-000000000001' }),
      json: async () => body } as unknown as Parameters<typeof POST>[0])
}

describe('POST /api/transcripts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getCurrentUserMock.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001', email: '' })
  })

  test.each([null, '', '00000000-0000-0000-0000-000000000099'])(
    'refuses a missing or different expected account before any writes (%s)', async (expected) => {
      const request = {
        headers: new Headers(expected === null ? {} : { [EXPECTED_USER_HEADER]: expected }),
        json: jest.fn(async () => ({ filename: 'audio.mp3' })),
      }
      const response = await POST(request as never)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'ACCOUNT_CHANGED' })
      expect(request.json).not.toHaveBeenCalled()
      expect(fromMock).not.toHaveBeenCalled()
    }
  )

  test('a signed-out request remains unauthorized before the account check', async () => {
    getCurrentUserMock.mockResolvedValue(null)
    const request = { headers: new Headers(), json: jest.fn() }
    const response = await POST(request as never)
    expect(response.status).toBe(401)
    expect(request.json).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  test('missing filename returns 400', async () => {
    const req = { headers: new Headers({ [EXPECTED_USER_HEADER]: '00000000-0000-0000-0000-000000000001' }),
      json: async () => ({ title: 'test' }) } as any

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  test('empty filename returns 400', async () => {
    const req = { headers: new Headers({ [EXPECTED_USER_HEADER]: '00000000-0000-0000-0000-000000000001' }),
      json: async () => ({ filename: '' }) } as any

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

  test('leaves status to its database default', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    await postTranscript(transcripts, { filename: 'audio.mp3' })

    // The authenticated role holds no INSERT grant on status.
    expect(transcripts.insertMock.mock.calls[0]).toEqual([
      expect.not.objectContaining({ status: expect.anything() }),
    ])
  })

  test('stores the chosen transcription options on the row', async () => {
    const options = { engine: 'deepgram', language: 'fr', detect_speakers: false, keep_filler_words: false, mask_profanity: true }
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    const res = await postTranscript(transcripts, { filename: 'audio.mp3', transcription_options: options })

    expect(res.status).toBe(200)
    expect(transcripts.insertMock.mock.calls[0]).toEqual([expect.objectContaining(options)])
  })

  test('a tab opened before the engine could be chosen gets Deepgram', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    const res = await postTranscript(transcripts, {
      filename: 'audio.mp3',
      transcription_options: { language: 'en', detect_speakers: true, keep_filler_words: true, mask_profanity: false },
    })

    expect(res.status).toBe(200)
    expect(transcripts.insertMock.mock.calls[0]).toEqual([
      expect.objectContaining({ engine: 'deepgram', language: 'en', keep_filler_words: true }),
    ])
  })

  test('a Soniox transcript records filler words and profanity masking off, which Soniox cannot do', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    await postTranscript(transcripts, {
      filename: 'audio.mp3',
      transcription_options: { engine: 'soniox', language: 'en', detect_speakers: true, keep_filler_words: true, mask_profanity: true },
    })

    expect(transcripts.insertMock.mock.calls[0]).toEqual([
      expect.objectContaining({ engine: 'soniox', language: 'en', keep_filler_words: false, mask_profanity: false }),
    ])
  })

  test('refuses an engine not offered', async () => {
    const transcripts = makeTranscriptTable({ insertResults: [] })

    const res = await postTranscript(transcripts, {
      filename: 'audio.mp3',
      transcription_options: { engine: 'whisper', language: 'en', detect_speakers: true, keep_filler_words: true, mask_profanity: false },
    })

    expect(res.status).toBe(400)
    expect(transcripts.insertMock).not.toHaveBeenCalled()
  })

  test.each(['es', 'multi'])('records filler words off for %s, where Deepgram is never asked for them', async (language) => {
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    await postTranscript(transcripts, {
      filename: 'audio.mp3',
      transcription_options: { engine: 'deepgram', language, detect_speakers: true, keep_filler_words: true, mask_profanity: false },
    })

    expect(transcripts.insertMock.mock.calls[0]).toEqual([
      expect.objectContaining({ language, keep_filler_words: false }),
    ])
  })

  test('without options leaves them to the column defaults', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [{ data: makeRow(), error: null }],
    })

    await postTranscript(transcripts, { filename: 'audio.mp3' })

    expect(transcripts.insertMock.mock.calls[0]).toEqual([
      expect.not.objectContaining({ language: expect.anything() }),
    ])
  })

  test('refuses a language not offered', async () => {
    const transcripts = makeTranscriptTable({ insertResults: [] })

    const res = await postTranscript(transcripts, {
      filename: 'audio.mp3',
      transcription_options: { engine: 'deepgram', language: 'xx', detect_speakers: true, keep_filler_words: true, mask_profanity: false },
    })

    expect(res.status).toBe(400)
    expect(transcripts.insertMock).not.toHaveBeenCalled()
  })

  test('an upload-intent dedup keeps the existing row, writing no options', async () => {
    const transcripts = makeTranscriptTable({
      insertResults: [],
      existingResults: [makeRow({ project_id: null })],
    })

    const res = await postTranscript(transcripts, {
      filename: 'audio.mp3',
      upload_intent_id: 'intent-1',
      transcription_options: { engine: 'deepgram', language: 'de', detect_speakers: true, keep_filler_words: true, mask_profanity: false },
    })

    expect(res.status).toBe(200)
    expect(transcripts.insertMock).not.toHaveBeenCalled()
  })
})
