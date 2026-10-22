/** @jest-environment node */

import { getCallbackUrl, startAsyncTranscription } from '@/infra/deepgram'
import { getEngine } from '@/lib/transcription/engines.server'
import { DEFAULT_TRANSCRIPTION_OPTIONS, type TranscriptionOptions } from '@/contracts/transcription-options'

const fetchMock = jest.fn()

async function sentParams({
  tag,
  transcription = {},
}: { tag?: string; transcription?: Partial<TranscriptionOptions> } = {}) {
  const saved = { ...process.env }
  process.env.DEEPGRAM_API_KEY = 'test-key'
  delete process.env.DEEPGRAM_MODEL
  delete process.env.DEEPGRAM_TAG
  if (tag) process.env.DEEPGRAM_TAG = tag
  try {
    await startAsyncTranscription({
      mediaUrl: 'https://storage.example/audio.webm',
      callbackUrl: 'https://app.example/api/webhooks/deepgram',
      transcriptId: 'transcript-1',
      jobId: 'job-1',
      userId: 'user-1',
      keyTerms: ['Acme', 'Move X'],
      transcription: { ...DEFAULT_TRANSCRIPTION_OPTIONS, ...transcription },
    })
  } finally {
    process.env = saved
  }
  return new URL(fetchMock.mock.calls[0][0] as string).searchParams
}

describe('Deepgram request options', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request_id: 'req-1' }) })
    global.fetch = fetchMock
  })

  test('uses the latest diarizer and never the deprecated diarize flag', async () => {
    const params = await sentParams()

    expect(params.get('diarize_model')).toBe('latest')
    expect(params.has('diarize')).toBe(false)
  })

  test('keeps filler words and opts out of model improvement', async () => {
    const params = await sentParams()

    expect(params.get('filler_words')).toBe('true')
    expect(params.get('mip_opt_out')).toBe('true')
  })

  test('names the transcript, the exact job attempt and the owner in extra, for the callback', async () => {
    const params = await sentParams()

    expect(params.getAll('extra')).toEqual(['transcript_id:transcript-1', 'job_id:job-1', 'user_id:user-1'])
  })

  test('keeps the existing formatting, callback, transcript id and key terms', async () => {
    const params = await sentParams()

    expect(params.get('model')).toBe('nova-3')
    expect(params.get('smart_format')).toBe('true')
    expect(params.get('paragraphs')).toBe('true')
    expect(params.get('callback')).toBe('https://app.example/api/webhooks/deepgram')
    expect(params.getAll('extra')).toContain('transcript_id:transcript-1')
    expect(params.getAll('keyterm')).toEqual(['Acme', 'Move X'])
  })

  test('tags the request only when DEEPGRAM_TAG is set', async () => {
    expect((await sentParams()).has('tag')).toBe(false)

    fetchMock.mockClear()
    expect((await sentParams({ tag: 'local' })).get('tag')).toBe('local')
  })

  describe('transcription options', () => {
    test('the defaults ask for English, speakers and filler words, unmasked', async () => {
      const params = await sentParams()

      expect(params.get('language')).toBe('en')
      expect(params.get('diarize_model')).toBe('latest')
      expect(params.get('filler_words')).toBe('true')
      expect(params.has('profanity_filter')).toBe(false)
    })

    test('speakers off leaves out the diarizer', async () => {
      const params = await sentParams({ transcription: { detect_speakers: false } })

      expect(params.has('diarize_model')).toBe(false)
      expect(params.has('diarize')).toBe(false)
    })

    test('filler words off leaves them out', async () => {
      const params = await sentParams({ transcription: { keep_filler_words: false } })

      expect(params.has('filler_words')).toBe(false)
    })

    test('filler words are never asked for outside English', async () => {
      for (const language of ['es', 'multi'] as const) {
        fetchMock.mockClear()
        const params = await sentParams({ transcription: { language, keep_filler_words: true } })

        expect(params.get('language')).toBe(language)
        expect(params.has('filler_words')).toBe(false)
      }
    })

    test('masking profanity asks for the filter, and key terms still go in any language', async () => {
      const params = await sentParams({ transcription: { language: 'multi', mask_profanity: true } })

      expect(params.get('profanity_filter')).toBe('true')
      expect(params.getAll('keyterm')).toEqual(['Acme', 'Move X'])
    })
  })
})

describe('Deepgram callback credentials', () => {
  const SECRET = '0123456789abcdef'.repeat(4)
  let saved: NodeJS.ProcessEnv

  beforeEach(() => {
    saved = { ...process.env }
    process.env.DEEPGRAM_WEBHOOK_SECRET = SECRET
    process.env.DEEPGRAM_CALLBACK_URL = 'https://tunnel.example/api/webhooks/deepgram'
    delete process.env.NEXT_PUBLIC_APP_URL
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request_id: 'req-1' }) })
    global.fetch = fetchMock
  })

  afterEach(() => {
    process.env = saved
  })

  test('the callback URL carries deepgram:<secret> for Deepgram to send back as Basic Auth', () => {
    const url = new URL(getCallbackUrl())
    expect(url.username).toBe('deepgram')
    expect(url.password).toBe(SECRET)
    expect(`${url.origin}${url.pathname}`).toBe('https://tunnel.example/api/webhooks/deepgram')
  })

  test('without a tunnel it is built from the app URL, credentials and all', () => {
    delete process.env.DEEPGRAM_CALLBACK_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example/'
    expect(getCallbackUrl()).toBe(`https://deepgram:${SECRET}@app.example/api/webhooks/deepgram`)
  })

  test('refuses plain http except on the machine itself, where the secret never leaves it', () => {
    process.env.DEEPGRAM_CALLBACK_URL = 'http://app.example/api/webhooks/deepgram'
    expect(() => getCallbackUrl()).toThrow('must use https, except on localhost')

    for (const local of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      process.env.DEEPGRAM_CALLBACK_URL = `${local}/api/webhooks/deepgram`
      expect(new URL(getCallbackUrl()).password).toBe(SECRET)
    }
  })

  test('refuses to make one without a secret, or with one that is not hex', () => {
    delete process.env.DEEPGRAM_WEBHOOK_SECRET
    expect(() => getCallbackUrl()).toThrow('DEEPGRAM_WEBHOOK_SECRET must be configured')
    process.env.DEEPGRAM_WEBHOOK_SECRET = 'not%41hex'.padEnd(40, 'x')
    expect(() => getCallbackUrl()).toThrow('DEEPGRAM_WEBHOOK_SECRET must be hex')
  })

  test('the URL it makes is exactly the callback Deepgram is sent, through the engine registry', async () => {
    process.env.DEEPGRAM_API_KEY = 'test-key'

    await getEngine('deepgram').start({
      mediaUrl: 'https://storage.example/audio.webm',
      transcriptId: 'transcript-1',
      jobId: 'job-1',
      userId: 'user-1',
      options: DEFAULT_TRANSCRIPTION_OPTIONS,
    })

    const sent = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('callback')
    expect(sent).toBe(getCallbackUrl())
    expect(new URL(sent ?? '').password).toBe(SECRET)
  })

  test('a Deepgram error that quotes the callback URL is logged and kept without the secret', async () => {
    process.env.DEEPGRAM_API_KEY = 'test-key'
    const quoted = `Bad callback: ${getCallbackUrl()}`
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => quoted })
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await startAsyncTranscription({
      mediaUrl: 'https://storage.example/audio.webm',
      callbackUrl: getCallbackUrl(),
      transcriptId: 'transcript-1',
      jobId: 'job-1',
      userId: 'user-1',
      transcription: DEFAULT_TRANSCRIPTION_OPTIONS,
    })

    expect(result.error).toContain('deepgram:***@tunnel.example')
    expect(result.error).not.toContain(SECRET)
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET)
    logged.mockRestore()
  })
})
