type SupabaseMutationResult = { error: null | { message: string } }

const uploadMock = jest.fn(async () => ({ error: null }))
const removeMock = jest.fn(async () => ({ error: null }))
const updateEqMock = jest.fn(async (): Promise<SupabaseMutationResult> => ({ error: null }))
const updateMock = jest.fn(() => ({ eq: updateEqMock }))
const deleteEqMock = jest.fn(async () => ({ error: null }))
const deleteMock = jest.fn(() => ({ eq: deleteEqMock }))
const fromMock = jest.fn(() => ({ update: updateMock, delete: deleteMock }))

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
    updateEqMock.mockResolvedValue({ error: null })
    deleteEqMock.mockResolvedValue({ error: null })
    ;(global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock
  })

  test('dedup hit with linked media skips upload/link and keys the start request', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project: { id: 'p1' },
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
    // Media was already linked, so neither storage upload nor the project update ran.
    expect(uploadMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    // Start is keyed off the intent id for cross-attempt dedup.
    expect(startCallHeaders(1)['x-idempotency-key']).toBe('start:intent-1')
  })

  test('an errored prior start (409 status:error) retries once with a fresh key', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project: { id: 'p1' },
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
    // Retry uses a distinct fresh key (one-active-per-project guards duplicates).
    expect(startCallHeaders(2)['x-idempotency-key']).toMatch(/^start-retry:/)
  })

  test('plain conflict 409 (no status) is not retried', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          project: { id: 'p1' },
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
          project: { id: 'p1' },
          storagePath: 'u/p1/rec.webm',
          deduped: false,
          sourceObjectKey: null,
          status: 'created',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { message: 'ok', jobId: 'j1' }))

    const result = await runCaptureUpload(makeFile(), 'Title', [])

    expect(result.kind).toBe('success')
    // Fresh project with no linked media → upload + link ran.
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(startCallHeaders(1)['x-idempotency-key']).toBeUndefined()
  })

  test('cancel after linking a fresh project but before start rolls back media and project', async () => {
    updateEqMock.mockReturnValueOnce({
      abortSignal: jest.fn(async () => ({ error: null })),
    } as never)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        project: { id: 'p1' },
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

  test('dedup hit without linked media does not delete the canonical project on rollback', async () => {
    updateEqMock.mockResolvedValueOnce({ error: { message: 'link failed' } })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        project: { id: 'p1' },
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

    expect(result.kind).toBe('failure')
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['u/p1/rec.webm'])
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
