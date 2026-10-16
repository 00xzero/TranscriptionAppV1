/** @jest-environment node */

import { gunzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTranscriptionResultPath, RESULTS_BUCKET } from '@/infra/supabase/storage'
import {
  downloadTranscriptionResult,
  removeTranscriptionResult,
  uploadTranscriptionResult,
} from '@/infra/supabase/transcription-results.server'

function fakeBucket() {
  const files = new Map<string, Buffer>()
  const calls: Array<{ bucket: string; method: string; options?: unknown }> = []
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: jest.fn(async (path: string, body: Buffer, options: unknown) => {
          calls.push({ bucket, method: 'upload', options })
          files.set(path, body)
          return { data: { path }, error: null }
        }),
        download: jest.fn(async (path: string) => {
          calls.push({ bucket, method: 'download' })
          const body = files.get(path)
          return body
            ? { data: new Blob([new Uint8Array(body)]), error: null }
            : { data: null, error: { message: 'Object not found' } }
        }),
        remove: jest.fn(async (paths: string[]) => {
          calls.push({ bucket, method: 'remove' })
          paths.forEach((path) => files.delete(path))
          return { data: paths.map((name) => ({ name })), error: null }
        }),
      }),
    },
  } as unknown as SupabaseClient
  return { client, files, calls }
}

describe('transcription results storage', () => {
  const path = getTranscriptionResultPath('user-1', 'transcript-1', 'job-1')

  test('names one file per job inside the transcript folder', () => {
    expect(path).toBe('user-1/transcript-1/job-1.json.gz')
  })

  test('stores the text gzipped and reads back the exact text', async () => {
    const { client, files, calls } = fakeBucket()
    // Formatting and unknown fields must survive untouched.
    const raw = JSON.stringify({ metadata: { request_id: 'r' }, model_info: { é: 'ü' } }, null, 2)

    const { bytes } = await uploadTranscriptionResult(client, path, raw)

    const stored = files.get(path)!
    expect(gunzipSync(stored).toString('utf8')).toBe(raw)
    expect(bytes).toBe(stored.byteLength)
    expect(calls[0]).toEqual({
      bucket: RESULTS_BUCKET,
      method: 'upload',
      options: { contentType: 'application/gzip', upsert: true },
    })

    await expect(downloadTranscriptionResult(client, path)).resolves.toBe(raw)
  })

  test('compresses a typical response well', async () => {
    const { client } = fakeBucket()
    const words = Array.from({ length: 5000 }, (_, i) => ({
      word: 'hello', start: i * 0.3, end: i * 0.3 + 0.25, confidence: 0.98, speaker: i % 2,
      punctuated_word: 'Hello,', speaker_confidence: 0.9,
    }))
    const raw = JSON.stringify({ results: { channels: [{ alternatives: [{ words }] }] } })

    const { bytes } = await uploadTranscriptionResult(client, path, raw)

    expect(bytes).toBeLessThan(Buffer.byteLength(raw) / 5)
  })

  test('throws when the upload or download fails', async () => {
    const failing = {
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: { message: 'bucket full' } }),
          download: async () => ({ data: null, error: { message: 'Object not found' } }),
        }),
      },
    } as unknown as SupabaseClient

    await expect(uploadTranscriptionResult(failing, path, '{}')).rejects.toThrow('bucket full')
    await expect(downloadTranscriptionResult(failing, path)).rejects.toThrow('Object not found')
  })

  test('removes a file without throwing', async () => {
    const { client, files } = fakeBucket()
    await uploadTranscriptionResult(client, path, '{}')

    await removeTranscriptionResult(client, path, 'test')

    expect(files.has(path)).toBe(false)
  })
})
