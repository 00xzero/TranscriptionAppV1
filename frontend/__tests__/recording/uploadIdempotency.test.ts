type SupabaseMutationResult = {
  data: { id: string } | null
  error: null | { code?: string; message: string }
}

type SupabaseReconcileResult = {
  data: { source_object_key: string } | null
  error: null | { message: string }
}

const uploadMock = jest.fn(async () => ({ error: null }))
const removeMock = jest.fn(async () => ({ error: null }))
const updateSingleMock = jest.fn(async (): Promise<SupabaseMutationResult> => ({
  data: { id: 'p1' },
  error: null,
}))
const updateAbortSignalMock = jest.fn(() => ({ single: updateSingleMock }))
const updateSelectMock = jest.fn(() => ({
  single: updateSingleMock,
  abortSignal: updateAbortSignalMock,
}))
const updateEqMock = jest.fn(() => ({ select: updateSelectMock }))
const updateMock = jest.fn(() => ({ eq: updateEqMock }))
const reconcileMaybeSingleMock = jest.fn(async (): Promise<SupabaseReconcileResult> => ({
  data: { source_object_key: 'u/p1/rec.webm' },
  error: null,
}))
const reconcileEqMock = jest.fn(() => ({ maybeSingle: reconcileMaybeSingleMock }))
const reconcileSelectMock = jest.fn(() => ({ eq: reconcileEqMock }))
const deleteEqMock = jest.fn(async () => ({ error: null }))
const deleteMock = jest.fn(() => ({ eq: deleteEqMock }))
const fromMock = jest.fn(() => ({
  update: updateMock,
  select: reconcileSelectMock,
  delete: deleteMock,
}))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: uploadMock, remove: removeMock }) },
    from: fromMock,
  }),
}))

import { runCaptureUpload } from '@/lib/capture/upload'

interface FakeResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  clone: () => FakeResponse
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => jsonResponse(status, body),
  }
}

const fetchMock = jest.fn()

function makeFile(): File {
  return new File([new Uint8Array(16)], 'rec.webm', { type: 'audio/webm' })
}

function startCallHeaders(callIndex: number): Record<string, string> {
  const call = fetchMock.mock.calls[callIndex]
  return (call[1]?.headers ?? {}) as Record<string, string>
}

describe('runCaptureUpload upload idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    uploadMock.mockResolvedValue({ error: null })
    removeMock.mockResolvedValue({ error: null })
    updateSingleMock.mockResolvedValue({ data: { id: 'p1' }, error: null })
    reconcileMaybeSingleMock.mockResolvedValue({
      data: { source_object_key: 'u/p1/rec.webm' },
      error: null,
    })
    deleteEqMock.mockResolvedValue({ error: null })
    ;(global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock
  })

  test('dedup hit with linked media skips upload/link and keys the start request', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: true,
          sourceObjectKey: 'u/p1/rec.webm',
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j1' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      uploadIntentId: 'intent-1',
    })

    expect(result.kind).toBe('success')
    // Media was already linked, so neither storage upload nor the transcript update ran.
    expect(uploadMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    // Start is keyed off the intent id for cross-attempt dedup.
    expect(startCallHeaders(1)['x-idempotency-key']).toBe('start:intent-1')
  })

  test('an errored prior start (409 status:error) retries once with a fresh key', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: true,
          sourceObjectKey: 'u/p1/rec.webm',
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(409, { error: 'failed', status: 'error', jobId: 'j0' }))
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j2' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      uploadIntentId: 'intent-1',
    })

    expect(result.kind).toBe('success')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(startCallHeaders(1)['x-idempotency-key']).toBe('start:intent-1')
    // Retry uses a distinct fresh key (one-active-per-transcript guards duplicates).
    expect(startCallHeaders(2)['x-idempotency-key']).toMatch(/^start-retry:/)
  })

  test('plain conflict 409 (no status) is not retried', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: true,
          sourceObjectKey: 'u/p1/rec.webm',
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Transcription already in progress' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      uploadIntentId: 'intent-1',
    })

    expect(result.kind).toBe('success') // already-in-progress is a benign conflict-ish
    // No retry beyond create + the single start attempt.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('the file-upload path (no intent id) sends no idempotency key', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: false,
          sourceObjectKey: null,
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j1' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result.kind).toBe('success')
    // Fresh transcript with no linked media → upload + link ran.
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(startCallHeaders(1)['x-idempotency-key']).toBeUndefined()
  })

  test('sends the project id and preserves a project-missing warning', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: false,
          sourceObjectKey: null,
          status: 'created',
          warning: 'project_missing',
        })
      )
      .mockResolvedValueOnce(jsonResponse(500, { error: 'start failed' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      projectId: '00000000-0000-0000-0000-000000000003',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      project_id: '00000000-0000-0000-0000-000000000003',
    })
    expect(result).toMatchObject({
      kind: 'success',
      outcome: 'saved_needs_retry',
      warning: 'project_missing',
    })
  })

  test('cancel after linking a fresh transcript but before start rolls back media and transcript', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        transcript: { id: 'p1' },
        storagePath: 'u/p1/rec.webm',
        deduped: false,
        sourceObjectKey: null,
        status: 'created',
      })
    )
    const controller = new AbortController()

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress === 'starting') controller.abort()
      },
    })

    expect(result.kind).toBe('failure')
    expect(result.message).toContain('Upload canceled')
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['u/p1/rec.webm'])
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('dedup hit without linked media does not delete the canonical transcript on rollback', async () => {
    updateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'link failed' },
    })
    reconcileMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        transcript: { id: 'p1' },
        storagePath: 'u/p1/rec.webm',
        deduped: true,
        sourceObjectKey: null,
        status: 'created',
      })
    )

    const result = await runCaptureUpload(makeFile(), 'Title', [], {
      uploadIntentId: 'intent-1',
      allowUpsert: true,
    })

    expect(result).toEqual({
      kind: 'failure',
      message: 'Failed to update transcript: link failed',
    })
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['u/p1/rec.webm'])
    expect(deleteMock).not.toHaveBeenCalled()
  })

  test('continues when an ambiguous link failure reconciles to the uploaded key', async () => {
    updateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: false,
          sourceObjectKey: null,
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j1' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result).toMatchObject({ kind: 'success', outcome: 'started' })
    expect(reconcileSelectMock).toHaveBeenCalledWith('source_object_key')
    expect(removeMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  test('preserves storage and the transcript when ambiguous link reconciliation fails', async () => {
    updateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'ETIMEDOUT', message: 'response lost' },
    })
    reconcileMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'read failed' },
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        transcript: { id: 'p1' },
        storagePath: 'u/p1/rec.webm',
        deduped: false,
        sourceObjectKey: null,
        status: 'created',
      })
    )

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result).toEqual({
      kind: 'failure',
      message: 'Failed to update transcript: response lost; reconciliation failed: read failed',
    })
    expect(removeMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  test('zero affected rows enters rollback after upload', async () => {
    updateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        transcript: { id: 'p1' },
        storagePath: 'u/p1/rec.webm',
        deduped: false,
        sourceObjectKey: null,
        status: 'created',
      })
    )

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result).toEqual({
      kind: 'failure',
      message: 'Failed to update transcript: the transcript is no longer available',
    })
    expect(removeMock).toHaveBeenCalledWith(['u/p1/rec.webm'])
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(reconcileMaybeSingleMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('reports the project-deleting message and enters rollback on PJ002', async () => {
    updateSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PJ002', message: 'project is being deleted' },
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        transcript: { id: 'p1' },
        storagePath: 'u/p1/rec.webm',
        deduped: false,
        sourceObjectKey: null,
        status: 'created',
      })
    )

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result).toEqual({ kind: 'failure', message: 'That project is being deleted.' })
    expect(removeMock).toHaveBeenCalledWith(['u/p1/rec.webm'])
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(reconcileMaybeSingleMock).not.toHaveBeenCalled()
  })
})

describe('runCaptureUpload title', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transcript: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: true,
          sourceObjectKey: 'u/p1/rec.webm',
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j1' }))
  })

  function createRequestTitle(): string {
    return JSON.parse(fetchMock.mock.calls[0][1].body).title
  }

  test('passes an explicit title through unchanged, even over the limit', async () => {
    const title = 'x'.repeat(130)
    await runCaptureUpload(makeFile(), title, [])
    expect(createRequestTitle()).toBe(title)
  })

  test('fits only the filename fallback under the limit', async () => {
    const longName = new File([new Uint8Array(16)], `${'y'.repeat(200)}.webm`, { type: 'audio/webm' })
    await runCaptureUpload(longName, '', [])
    expect(createRequestTitle()).toHaveLength(120)
    expect(createRequestTitle().endsWith('…')).toBe(true)
  })
})
