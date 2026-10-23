/** @jest-environment node */

import { DEFAULT_TRANSCRIPTION_OPTIONS, type TranscriptionOptions } from '@/contracts/transcription-options'
import {
  buildAssemblyAIRequest,
  deleteAssemblyAITranscript,
  fetchAssemblyAITranscript,
  getAssemblyAICallbackUrl,
  startAssemblyAITranscription,
} from '@/infra/assemblyai'

const transcriptId = '11111111-1111-4111-8111-111111111111'
const jobId = '33333333-3333-4333-8333-333333333333'
const assemblyai: TranscriptionOptions = { ...DEFAULT_TRANSCRIPTION_OPTIONS, engine: 'assemblyai' }

const fetchMock = jest.fn()
const ENV = { ...process.env }

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env = {
    ...ENV,
    ASSEMBLYAI_API_KEY: 'test-key',
    ASSEMBLYAI_WEBHOOK_SECRET: 'test-secret',
    DEEPGRAM_CALLBACK_URL: 'https://janiya-slinkier-cursorily.ngrok-free.dev/api/webhooks/deepgram',
  }
  delete process.env.ASSEMBLYAI_API_URL
})

afterAll(() => {
  process.env = ENV
})

function body(options: Partial<TranscriptionOptions> = {}, keyTerms?: string[]) {
  return buildAssemblyAIRequest({
    mediaUrl: 'https://storage.test/media.m4a',
    keyTerms,
    options: { ...assemblyai, ...options },
    webhookUrl: 'https://app.test/api/webhooks/assemblyai',
    webhookSecret: 'test-secret',
  })
}

describe('buildAssemblyAIRequest', () => {
  test('asks Universal-3.5 Pro (Universal-2 behind it) for the audio at our URL, keeping fillers, calling back with our secret', () => {
    expect(body()).toEqual({
      audio_url: 'https://storage.test/media.m4a',
      speech_models: ['universal-3-5-pro', 'universal-2'],
      speaker_labels: true,
      disfluencies: true,
      language_code: 'en',
      webhook_url: 'https://app.test/api/webhooks/assemblyai',
      webhook_auth_header_name: 'Authorization',
      webhook_auth_header_value: 'Bearer test-secret',
    })
  })

  test.each(['es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'hi', 'ru'] as const)('sends %s as the one language', (language) => {
    const request = body({ language })
    expect(request).toEqual(expect.objectContaining({ language_code: language }))
    expect(request).not.toHaveProperty('language_codes')
  })

  test('mixed languages listen for the nine other than Russian', () => {
    const request = body({ language: 'multi' })
    expect(request).toEqual(expect.objectContaining({
      language_codes: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'hi'],
    }))
    expect(request).not.toHaveProperty('language_code')
  })

  test('speaker detection off is sent off', () => {
    expect(body({ detect_speakers: false })).toEqual(expect.objectContaining({ speaker_labels: false }))
  })

  test('profanity masking is asked for only when recorded on', () => {
    expect(body({ mask_profanity: true })).toEqual(expect.objectContaining({ filter_profanity: true }))
    expect(body({ mask_profanity: false })).not.toHaveProperty('filter_profanity')
  })

  test('fillers are kept whatever the switch was left at', () => {
    expect(body({ keep_filler_words: false })).toEqual(expect.objectContaining({ disfluencies: true }))
  })

  test('key terms go in keyterms_prompt, and none sends none', () => {
    expect(body({}, ['Qwyntessa', 'Brixtonne'])).toEqual(expect.objectContaining({ keyterms_prompt: ['Qwyntessa', 'Brixtonne'] }))
    expect(body({}, [])).not.toHaveProperty('keyterms_prompt')
  })
})

describe('getAssemblyAICallbackUrl', () => {
  test('names the exact attempt on the tunnel', () => {
    expect(getAssemblyAICallbackUrl({ transcriptId, jobId })).toBe(
      `https://janiya-slinkier-cursorily.ngrok-free.dev/api/webhooks/assemblyai?transcript_id=${transcriptId}&job_id=${jobId}`
    )
  })

  test('falls back to the app URL', () => {
    delete process.env.DEEPGRAM_CALLBACK_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test/'
    expect(getAssemblyAICallbackUrl({ transcriptId, jobId })).toMatch(/^https:\/\/app\.test\/api\/webhooks\/assemblyai\?/)
  })
})

describe('startAssemblyAITranscription', () => {
  const start = () => startAssemblyAITranscription({ mediaUrl: 'https://storage.test/media.m4a', transcriptId, jobId, options: assemblyai })

  test('returns the AssemblyAI transcript id as the request id, on the EU servers, with the key as it is', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'aai-transcript-1', status: 'queued' }), { status: 200 }))

    await expect(start()).resolves.toEqual({ requestId: 'aai-transcript-1', error: null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.eu.assemblyai.com/v2/transcript')
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'test-key' }))
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      webhook_url: expect.stringContaining(`job_id=${jobId}`),
    }))
  })

  test('ASSEMBLYAI_API_URL picks another region', async () => {
    process.env.ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/'
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'aai-transcript-1' }), { status: 200 }))

    await start()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.assemblyai.com/v2/transcript')
  })

  test('returns an API refusal as an error', async () => {
    fetchMock.mockResolvedValue(new Response('{"error": "The following models are not available in this language: filter_profanity"}', { status: 400 }))

    await expect(start()).resolves.toEqual({ requestId: null, error: expect.stringContaining('AssemblyAI API error: 400') })
  })

  test('refuses to start without its settings', async () => {
    delete process.env.ASSEMBLYAI_WEBHOOK_SECRET
    await expect(start()).resolves.toEqual({ requestId: null, error: 'ASSEMBLYAI_WEBHOOK_SECRET is not configured' })
    delete process.env.ASSEMBLYAI_API_KEY
    await expect(start()).resolves.toEqual({ requestId: null, error: 'ASSEMBLYAI_API_KEY is not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchAssemblyAITranscript', () => {
  test('returns the answer as sent, and an errored one still parses with its error', async () => {
    const raw = { id: 'aai-transcript-1', status: 'error', error: 'Transcoding failed.', text: null, words: null }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }))

    const fetched = await fetchAssemblyAITranscript('aai-transcript-1')
    expect(fetched.raw).toEqual(raw)
    expect(fetched.transcript.error).toBe('Transcoding failed.')
  })
})

describe('deleteAssemblyAITranscript', () => {
  test('a deleted transcript, deleted again, succeeds', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'aai-transcript-1', text: 'Deleted by user.' }), { status: 200 }))
    await expect(deleteAssemblyAITranscript('aai-transcript-1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'DELETE' }))
  })

  test('one AssemblyAI no longer knows (400 "not found") counts as deleted', async () => {
    fetchMock.mockResolvedValue(new Response('{"error": "Transcript lookup error, transcript id not found"}', { status: 400 }))
    await expect(deleteAssemblyAITranscript('aai-transcript-1')).resolves.toBeUndefined()
  })

  test('any other refusal is an error, so the step retries', async () => {
    fetchMock.mockResolvedValue(new Response('{"error": "Transcript is still processing"}', { status: 400 }))
    await expect(deleteAssemblyAITranscript('aai-transcript-1')).rejects.toThrow('AssemblyAI API error: 400')
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    await expect(deleteAssemblyAITranscript('aai-transcript-1')).rejects.toThrow('AssemblyAI API error: 503')
  })
})
