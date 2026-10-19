jest.mock('tus-js-client', () => ({
  __esModule: true,
  Upload: jest.fn(),
}))

import { Upload } from 'tus-js-client'
import {
  transferToStorage,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
} from '@/lib/capture/storageTransfer'

const UploadMock = Upload as unknown as jest.Mock

// The single-PUT path and session lookup go through the injected client.
type StorageUploadResult = { error: null | { message: string } }
type SessionResult = { data: { session: { access_token: string } | null } }
const putUploadMock = jest.fn(async (): Promise<StorageUploadResult> => ({ error: null }))
const getSessionMock = jest.fn(async (): Promise<SessionResult> => ({
  data: { session: { access_token: 'tok-123' } },
}))

const supabase = {
  storage: { from: () => ({ upload: putUploadMock }) },
  auth: { getSession: getSessionMock },
} as never

// Captured options from the most recent `new Upload(file, options)`.
let capturedOptions: Record<string, never> & {
  onSuccess: () => void
  onError: (e: Error) => void
  onProgress: (bytesSent: number, bytesTotal: number) => void
  onBeforeRequest: (req: { setHeader: (key: string, value: string) => void }) => Promise<void>
  metadata: Record<string, string>
  headers: Record<string, string>
  chunkSize: number
  endpoint: string
}
const startMock = jest.fn()
const abortMock = jest.fn(async () => {})

// Drives what `upload.start()` does; overridden per test.
let onStart: () => void = () => {
  queueMicrotask(() => capturedOptions.onSuccess())
}

function makeFile(size: number): File {
  const file = new File([new Uint8Array(8)], 'rec.webm', { type: 'audio/webm' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
  putUploadMock.mockResolvedValue({ error: null })
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } })
  onStart = () => {
    queueMicrotask(() => capturedOptions.onSuccess())
  }
  UploadMock.mockImplementation((_file: File, options: typeof capturedOptions) => {
    capturedOptions = options
    return { start: () => { startMock(); onStart() }, abort: abortMock }
  })
})

describe('transferToStorage', () => {
  test('small file (<= threshold) uses single-PUT, not the resumable path', async () => {
    const file = makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES)

    await transferToStorage(supabase, 'u/p1/rec.webm', file, {
      contentType: 'audio/webm',
      upsert: false,
    })

    expect(putUploadMock).toHaveBeenCalledTimes(1)
    expect(putUploadMock).toHaveBeenCalledWith('u/p1/rec.webm', file, {
      contentType: 'audio/webm',
      upsert: false,
    })
    expect(UploadMock).not.toHaveBeenCalled()
  })

  test('single-PUT error is surfaced as a thrown Error', async () => {
    putUploadMock.mockResolvedValueOnce({ error: { message: 'boom' } })

    await expect(
      transferToStorage(supabase, 'u/p1/rec.webm', makeFile(1024), {
        contentType: 'audio/webm',
        upsert: false,
      })
    ).rejects.toThrow('Upload failed: boom')
  })

  test('large file (> threshold) uses the resumable path with Supabase config', async () => {
    const file = makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1)

    await transferToStorage(supabase, 'u/p1/big.webm', file, {
      contentType: 'video/mp4',
      upsert: true,
    })

    expect(putUploadMock).not.toHaveBeenCalled()
    expect(UploadMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(capturedOptions.endpoint).toBe(
      'http://localhost:54321/storage/v1/upload/resumable'
    )
    expect(capturedOptions.chunkSize).toBe(6 * 1024 * 1024)
    expect(capturedOptions.metadata.objectName).toBe('u/p1/big.webm')
    expect(capturedOptions.metadata.bucketName).toBe('media')
    expect(capturedOptions.metadata.contentType).toBe('video/mp4')
    expect(capturedOptions.headers['x-upsert']).toBe('true')
    expect(capturedOptions.headers.authorization).toBeUndefined()
    // The raw TUS client must send the project key explicitly; supabase-js
    // normally adds this for the single-PUT path.
    expect(capturedOptions.headers.apikey).toBe('anon-test-key')

    const requestHeaders: Record<string, string> = {}
    await capturedOptions.onBeforeRequest({
      setHeader: (key: string, value: string) => {
        requestHeaders[key] = value
      },
    })
    expect(requestHeaders.authorization).toBe('Bearer tok-123')
  })

  test('hosted Supabase URL targets the direct storage hostname; dev stays as-is', async () => {
    // Hosted project -> rewrite <ref>.supabase.co to the direct storage host.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co'
    await transferToStorage(
      supabase,
      'u/p1/big.webm',
      makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      { contentType: 'audio/webm', upsert: false }
    )
    expect(capturedOptions.endpoint).toBe(
      'https://abcdefgh.storage.supabase.co/storage/v1/upload/resumable'
    )

    // Local dev host is left untouched.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    await transferToStorage(
      supabase,
      'u/p1/big2.webm',
      makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      { contentType: 'audio/webm', upsert: false }
    )
    expect(capturedOptions.endpoint).toBe(
      'http://localhost:54321/storage/v1/upload/resumable'
    )
  })

  test('resumable endpoint tolerates a configured Supabase URL with a trailing slash', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co/'
    await transferToStorage(
      supabase,
      'u/p1/big.webm',
      makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      { contentType: 'audio/webm', upsert: false }
    )
    expect(capturedOptions.endpoint).toBe(
      'https://abcdefgh.storage.supabase.co/storage/v1/upload/resumable'
    )
  })

  test('resumable onError rejects with the wrapped message', async () => {
    onStart = () => {
      queueMicrotask(() => capturedOptions.onError(new Error('network died')))
    }

    await expect(
      transferToStorage(supabase, 'u/p1/big.webm', makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1), {
        contentType: 'audio/webm',
        upsert: false,
      })
    ).rejects.toThrow('Upload failed: network died')
  })

  test('a file over the storage size limit says so plainly', async () => {
    onStart = () => {
      const tooLarge = Object.assign(new Error('tus: unexpected response while creating upload'), {
        originalResponse: { getStatus: () => 413 },
      })
      queueMicrotask(() => capturedOptions.onError(tooLarge))
    }

    await expect(
      transferToStorage(supabase, 'u/p1/big.webm', makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1), {
        contentType: 'audio/webm',
        upsert: false,
      })
    ).rejects.toThrow('Upload failed: this file is larger than storage accepts.')
  })

  test('aborting the signal terminates the resumable upload and rejects AbortError', async () => {
    onStart = () => {} // never completes on its own
    const controller = new AbortController()

    const promise = transferToStorage(
      supabase,
      'u/p1/big.webm',
      makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      { contentType: 'audio/webm', upsert: false, signal: controller.signal }
    )

    // Let getSession resolve and the upload start before aborting.
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(abortMock).toHaveBeenCalledWith(true)
  })

  test('small file reports progress once, after it is in', async () => {
    const file = makeFile(1024)
    const onProgress = jest.fn()
    putUploadMock.mockImplementationOnce(async () => {
      expect(onProgress).not.toHaveBeenCalled()
      return { error: null }
    })

    await transferToStorage(supabase, 'u/p1/rec.webm', file, {
      contentType: 'audio/webm',
      upsert: false,
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(1024, 1024)
  })

  test('small file that fails reports no progress', async () => {
    putUploadMock.mockResolvedValueOnce({ error: { message: 'boom' } })
    const onProgress = jest.fn()

    await expect(
      transferToStorage(supabase, 'u/p1/rec.webm', makeFile(1024), {
        contentType: 'audio/webm',
        upsert: false,
        onProgress,
      })
    ).rejects.toThrow('Upload failed: boom')
    expect(onProgress).not.toHaveBeenCalled()
  })

  test('large file reports bytes as they go and never goes backwards on a resend', async () => {
    const total = RESUMABLE_UPLOAD_THRESHOLD_BYTES * 3
    const onProgress = jest.fn()
    onStart = () => {
      queueMicrotask(() => {
        capturedOptions.onProgress(1_000_000, total)
        capturedOptions.onProgress(7_000_000, total)
        // A failed chunk is resent from its offset.
        capturedOptions.onProgress(6_291_456, total)
        capturedOptions.onProgress(7_000_000, total)
        capturedOptions.onProgress(9_000_000, total)
        capturedOptions.onSuccess()
      })
    }

    await transferToStorage(supabase, 'u/p1/big.webm', makeFile(total), {
      contentType: 'audio/webm',
      upsert: false,
      onProgress,
    })

    expect(onProgress.mock.calls).toEqual([
      [1_000_000, total],
      [7_000_000, total],
      [9_000_000, total],
    ])
  })

  test('large file reports nothing after it was aborted', async () => {
    onStart = () => {}
    const controller = new AbortController()
    const onProgress = jest.fn()

    const promise = transferToStorage(
      supabase,
      'u/p1/big.webm',
      makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      { contentType: 'audio/webm', upsert: false, signal: controller.signal, onProgress }
    )
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    capturedOptions.onProgress(1_000_000, RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1)
    expect(onProgress).not.toHaveBeenCalled()
  })

  test('missing session rejects before constructing the upload', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })

    await expect(
      transferToStorage(supabase, 'u/p1/big.webm', makeFile(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1), {
        contentType: 'audio/webm',
        upsert: false,
      })
    ).rejects.toThrow('no active session')
    expect(UploadMock).not.toHaveBeenCalled()
  })
})
