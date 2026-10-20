/** @jest-environment node */

/**
 * Soniox returns pieces of words. The fixtures are made up, shaped like the
 * pieces the POC got back for real English speech (2026-10-18).
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { sonioxResultToWords } from '@/core/transcription/engines/soniox-words'
import { buildRpcPayload } from '@/lib/transcription/segments-payload'

type Piece = {
  text: string
  start_ms?: number
  end_ms?: number
  confidence?: number
  speaker?: string | null
  is_audio_event?: boolean | null
  translation_status?: 'none' | 'original' | 'translation' | null
}

/** A piece at `start`, 60 ms long, as the POC saw them. */
function piece(text: string, start: number, extra: Partial<Piece> = {}): Piece {
  return { text, start_ms: start, end_ms: start + 60, confidence: 0.99, speaker: '1', ...extra }
}

function stored(tokens: Piece[], text = tokens.map((t) => t.text).join('')) {
  return JSON.stringify({
    transcription: { id: 'job-1', status: 'completed', model: 'stt-async-v5', audio_duration_ms: 60_000 },
    transcript: { id: 'job-1', text, tokens: tokens.map((t) => ({ confidence: 0.99, ...t })) },
  })
}

const words = (tokens: Piece[]) => sonioxResultToWords(stored(tokens)).words

describe('sonioxResultToWords', () => {
  test('joins pieces into words at leading spaces, keeping Soniox timings exactly', () => {
    const result = words([
      piece('To', 510),
      piece(' other', 1710),
      piece('w', 1890),
      piece('ise', 2010),
      piece(' we', 2310),
      piece("'", 2430),
      piece('ll', 2490),
      piece(' don', 3750),
      piece("'t", 3810),
    ])

    expect(result.map((w) => [w.punctuatedText, w.startMs, w.endMs])).toEqual([
      ['To', 510, 570],
      ['otherwise', 1710, 2070],
      ["we'll", 2310, 2550],
      ["don't", 3750, 3870],
    ])
    expect(result.map((w) => w.text)).toEqual(['to', 'otherwise', "we'll", "don't"])
  })

  test('punctuation joins the word before it, and ends sentences', () => {
    const result = words([piece(' Jeff', 750), piece(',', 990), piece(' clear', 1200), piece('.', 1260)])

    expect(result.map((w) => [w.punctuatedText, w.text, w.endMs, w.sentenceEnd])).toEqual([
      ['Jeff,', 'jeff', 1050, false],
      ['clear.', 'clear', 1320, true],
    ])
  })

  test("a word's confidence is its least sure piece", () => {
    const [word] = words([piece(' other', 0, { confidence: 0.58 }), piece('wise', 60, { confidence: 0.99 })])
    expect(word.confidence).toBe(0.58)
  })

  test('speakers become 0, 1, 2 in the order they first speak, and a new speaker starts a new word', () => {
    const result = words([
      piece(' Yes', 0, { speaker: '2' }),
      piece(' Okay', 500, { speaker: '1' }),
      piece('ay', 560, { speaker: '3' }),
      piece(' right', 900, { speaker: '2' }),
    ])

    expect(result.map((w) => [w.punctuatedText, w.speaker])).toEqual([
      ['Yes', 0],
      ['Okay', 1],
      ['ay', 2],
      ['right', 0],
    ])
  })

  test('a piece with no speaker label takes the last one', () => {
    const result = words([piece(' Hello', 0, { speaker: '1' }), piece(' there', 300, { speaker: null })])
    expect(result.map((w) => w.speaker)).toEqual([0, 0])
  })

  test('a piece missing its label inside a word does not split the word', () => {
    const result = words([piece(' other', 0, { speaker: '1' }), piece('wise', 60, { speaker: null }), piece(' then', 300)])
    expect(result.map((w) => [w.punctuatedText, w.speaker])).toEqual([
      ['otherwise', 0],
      ['then', 0],
    ])
  })

  test('words before the first label have no speaker', () => {
    const result = words([piece(' Hi', 0, { speaker: null }), piece(' there', 300, { speaker: '1' })])
    expect(result.map((w) => w.speaker)).toEqual([null, 0])
  })

  test('without speaker detection every speaker is null', () => {
    const result = words([piece(' Hello', 0, { speaker: null }), piece(' there', 300, { speaker: null })])
    expect(result.map((w) => w.speaker)).toEqual([null, null])
  })

  test('audio events, translations and untimed pieces are not words', () => {
    const result = words([
      piece(' Hello', 0),
      piece(' [laughter]', 300, { is_audio_event: true }),
      { text: ' Hola', confidence: 0.9, translation_status: 'translation' },
      { text: ' untimed', confidence: 0.9 },
      piece(' there', 900),
    ])
    expect(result.map((w) => w.punctuatedText)).toEqual(['Hello', 'there'])
  })

  test('Japanese, written without spaces, becomes a word per piece, with 、 and 。 closing the word before', () => {
    const tokens = [
      piece('今日', 0),
      piece('は', 60),
      piece('、', 120),
      piece('いい', 180),
      piece('天気', 240),
      piece('です', 300),
      piece('。', 360),
    ]
    const result = words(tokens)

    expect(result.map((w) => w.punctuatedText)).toEqual(['今日', 'は、', 'いい', '天気', 'です。'])
    expect(result.map((w) => w.text)).toEqual(['今日', 'は', 'いい', '天気', 'です'])
    // The stored and exported text keeps Soniox's spacing: none at all.
    expect(buildRpcPayload(sonioxResultToWords(stored(tokens))).segments.map((s) => s.text)).toEqual(['今日は、いい天気です。'])
  })

  test('English keeps its spaces, and Japanese inside it joins as written', () => {
    const tokens = [piece('The', 0), piece(' word', 120), piece(' 天気', 240), piece('です', 300), piece(' means', 420), piece(' weather', 540), piece('.', 600)]
    expect(buildRpcPayload(sonioxResultToWords(stored(tokens))).segments.map((s) => s.text)).toEqual(['The word 天気です means weather.'])
  })

  test('Hindi keeps its vowel signs, and । closes the word before', () => {
    const result = words([piece(' नमस्ते', 0), piece(' दोस्तों', 300), piece('।', 360)])

    expect(result.map((w) => [w.punctuatedText, w.text])).toEqual([
      ['नमस्ते', 'नमस्ते'],
      ['दोस्तों।', 'दोस्तों'],
    ])
  })

  test('punctuation before any word has nothing to join and is dropped', () => {
    expect(words([piece('"', 0), piece(' Hello', 60)]).map((w) => w.punctuatedText)).toEqual(['Hello'])
  })

  test('keeps the plain transcript for a result with no words', () => {
    expect(sonioxResultToWords(stored([], ''))).toEqual({ words: [], fallbackText: '' })
  })

  test('refuses a result that is not Soniox-shaped', () => {
    expect(() => sonioxResultToWords(JSON.stringify({ results: {} }))).toThrow('Invalid Soniox result structure')
  })

  test('the made-up two-speaker result becomes these segments', () => {
    const raw = readFileSync(join(__dirname, 'fixtures', 'soniox', 'two-speakers.json'), 'utf8')
    const payload = buildRpcPayload(sonioxResultToWords(raw))
    expect({
      speakers: payload.speakers,
      segments: payload.segments.map((segment, index) => ({
        ...segment,
        id: `segment-${index}`,
        words: segment.words.map((word) => JSON.stringify(word)),
      })),
    }).toMatchSnapshot()
  })
})
