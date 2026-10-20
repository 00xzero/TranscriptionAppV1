/** @jest-environment node */

import { DEFAULT_TRANSCRIPTION_OPTIONS, type TranscriptionOptions } from '@/contracts/transcription-options'
import {
  buildSonioxRequest,
  deleteSonioxTranscription,
  getSonioxCallbackUrl,
  startSonioxTranscription,
} from '@/infra/soniox'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const soniox: TranscriptionOptions = { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine: 'soniox', keep_filler_words: false }

const fetchMock = jest.fn()
const ENV = { ...process.env }

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env = {
    ...ENV,
    SONIOX_API_KEY: 'test-key',
    SONIOX_WEBHOOK_SECRET: 'test-secret',
    DEEPGRAM_CALLBACK_URL: 'https://janiya-slinkier-cursorily.ngrok-free.dev/api/webhooks/deepgram',
  }
  delete process.env.SONIOX_MODEL
})

afterAll(() => {
  process.env = ENV
})

function body(options: Partial<TranscriptionOptions> = {}, keyTerms?: string[]) {
  return buildSonioxRequest({
    mediaUrl: 'https://storage.test/media.m4a',
    jobId,
    keyTerms,
    options: { ...soniox, ...options },
    webhookUrl: 'https://app.test/api/webhooks/soniox',
    webhookSecret: 'test-secret',
  })
}

describe('buildSonioxRequest', () => {
  test('asks stt-async-v5 for the audio at our URL, with speakers, and calls back with our secret', () => {
    expect(body()).toEqual({
      model: 'stt-async-v5',
      audio_url: 'https://storage.test/media.m4a',
      client_reference_id: jobId,
      enable_speaker_diarization: true,
      language_hints: ['en'],
      language_hints_strict: true,
      webhook_url: 'https://app.test/api/webhooks/soniox',
      webhook_auth_header_name: 'Authorization',
      webhook_auth_header_value: 'Bearer test-secret',
    })
  })

  test('holds a single language strictly', () => {
    expect(body({ language: 'ja' })).toEqual(expect.objectContaining({ language_hints: ['ja'], language_hints_strict: true }))
  })

  test('mixed languages are identified, with the ten offered as hints only', () => {
    const request = body({ language: 'multi' })
    expect(request).toEqual(expect.objectContaining({
      enable_language_identification: true,
      language_hints: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'hi', 'ru'],
    }))
    expect(request).not.toHaveProperty('language_hints_strict')
  })

  test('speaker detection off is sent off', () => {
    expect(body({ detect_speakers: false })).toEqual(expect.objectContaining({ enable_speaker_diarization: false }))
  })

  test('key terms go in context.terms, and none sends no context', () => {
    expect(body({}, ['Dechra', 'Innoverv'])).toEqual(expect.objectContaining({ context: { terms: ['Dechra', 'Innoverv'] } }))
    expect(body({}, [])).not.toHaveProperty('context')
  })

  test('SONIOX_MODEL overrides the model', () => {
    process.env.SONIOX_MODEL = 'stt-async-v6'
    expect(body()).toEqual(expect.objectContaining({ model: 'stt-async-v6' }))
  })
})

describe('getSonioxCallbackUrl', () => {
  test('names the exact attempt on the tunnel, within Soniox\'s 256 characters', () => {
    const url = getSonioxCallbackUrl({ transcriptId, jobId })
    expect(url).toBe(`https://janiya-slinkier-cursorily.ngrok-free.dev/api/webhooks/soniox?transcript_id=${transcriptId}&job_id=${jobId}`)
    expect(url.length).toBeLessThanOrEqual(256)
  })

  test('falls back to the app URL', () => {
    delete process.env.DEEPGRAM_CALLBACK_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test/'
    expect(getSonioxCallbackUrl({ transcriptId, jobId })).toMatch(/^https:\/\/app\.test\/api\/webhooks\/soniox\?/)
  })
})

describe('startSonioxTranscription', () => {
  const start = () => startSonioxTranscription({ mediaUrl: 'https://storage.test/media.m4a', transcriptId, jobId, options: soniox })

  test('returns the Soniox job id as the request id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'soniox-job-1', status: 'queued' }), { status: 201 }))

    await expect(start()).resolves.toEqual({ requestId: 'soniox-job-1', error: null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.soniox.com/v1/transcriptions')
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer test-key' }))
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      webhook_url: expect.stringContaining(`job_id=${jobId}`),
    }))
  })

  test('returns an API refusal as an error', async () => {
    fetchMock.mockResolvedValue(new Response('{"error_type":"invalid_request","message":"bad"}', { status: 400 }))

    await expect(start()).resolves.toEqual({ requestId: null, error: expect.stringContaining('Soniox API error: 400') })
  })

  test('refuses to start without its settings', async () => {
    delete process.env.SONIOX_WEBHOOK_SECRET
    await expect(start()).resolves.toEqual({ requestId: null, error: 'SONIOX_WEBHOOK_SECRET is not configured' })
    delete process.env.SONIOX_API_KEY
    await expect(start()).resolves.toEqual({ requestId: null, error: 'SONIOX_API_KEY is not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteSonioxTranscription', () => {
  test('a job already gone counts as deleted', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    await expect(deleteSonioxTranscription('soniox-job-1')).resolves.toBeUndefined()
  })

  test('any other refusal is an error, so the step retries', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    await expect(deleteSonioxTranscription('soniox-job-1')).rejects.toThrow('Soniox API error: 503')
  })
})
