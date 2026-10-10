/** @jest-environment node */

import { startAsyncTranscription } from '@/infra/deepgram'

const fetchMock = jest.fn()

async function sentParams({ tag }: { tag?: string } = {}) {
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
      keyTerms: ['Acme', 'Move X'],
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

  test('keeps the existing formatting, callback, transcript id and key terms', async () => {
    const params = await sentParams()

    expect(params.get('model')).toBe('nova-3')
    expect(params.get('smart_format')).toBe('true')
    expect(params.get('paragraphs')).toBe('true')
    expect(params.get('callback')).toBe('https://app.example/api/webhooks/deepgram')
    expect(params.get('extra')).toBe('transcript_id:transcript-1')
    expect(params.getAll('keyterm')).toEqual(['Acme', 'Move X'])
  })

  test('tags the request only when DEEPGRAM_TAG is set', async () => {
    expect((await sentParams()).has('tag')).toBe(false)

    fetchMock.mockClear()
    expect((await sentParams({ tag: 'local' })).get('tag')).toBe('local')
  })
})
