/** @jest-environment node */

/**
 * Japanese is written without spaces between words. The fixtures are both
 * engines' real answers (2026-10-20) for one synthetic clip of macOS's Kyoko
 * voice saying おはようございます。今日はいい天気ですね。会議は三時に始まります。資料を準備してください。
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import type { NormalizedWord } from '@/core/transcript/segment-builder'
import { alignTokens, type SourceWord } from '@/core/transcript/word-alignment'
import { getEngine } from '@/lib/transcription/engines.server'
import { buildRpcPayload } from '@/lib/transcription/segments-payload'

const SPOKEN = 'おはようございます。今日はいい天気ですね。会議は3時に始まります。資料を準備してください。'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'japanese', `${name}.json`), 'utf8')

function run(engine: 'deepgram' | 'soniox') {
  const { words } = getEngine(engine).resultToWords(fixture(engine))
  const payload = buildRpcPayload({ words, fallbackText: '' })
  return { words, segments: payload.segments }
}

/** The words the editor aligns against, as it loads them (punctuated text). */
const sourceWords = (words: NormalizedWord[]): SourceWord[] =>
  words.map((w) => ({ text: w.punctuatedText, startMs: w.startMs, endMs: w.endMs }))

describe.each(['deepgram', 'soniox'] as const)('Japanese from %s', (engine) => {
  test('is stored and exported as written, without spaces', () => {
    const { segments } = run(engine)
    expect(segments.map((s) => s.text).join('')).toBe(SPOKEN)
    for (const segment of segments) expect(segment.text).not.toMatch(/\s/)
  })

  test('aligns word by word in the editor: one token per word, at that word\'s time', () => {
    const { words, segments } = run(engine)
    const segment = segments[0]
    const segmentWords = sourceWords(words.slice(0, segment.words.length))

    const tokens = alignTokens(segment.text, segmentWords, segment.start_ms, segment.end_ms)

    expect(tokens.map((t) => t.text).join('')).toBe(segment.text)
    expect(tokens.map((t) => t.text)).toEqual(segmentWords.map((w) => w.text))
    tokens.forEach((token, i) => {
      expect([token.wordFrom, token.wordTo]).toEqual([i, i + 1])
      expect([token.startMs, token.endMs]).toEqual([segmentWords[i].startMs, segmentWords[i].endMs])
    })
  })
})

describe('Japanese alignment after an edit', () => {
  test('a changed character is placed in its word\'s time; the words around keep theirs', () => {
    const { words, segments } = run('deepgram')
    const segment = segments[0]
    const segmentWords = sourceWords(words.slice(0, segment.words.length))
    // 天気 (weather) → 元気 (well)
    const edited = segment.text.replace('天気', '元気')

    const tokens = alignTokens(edited, segmentWords, segment.start_ms, segment.end_ms)

    expect(tokens.map((t) => t.text).join('')).toBe(edited)
    const kept = tokens.find((t) => t.text === '今日')!
    const keptWord = segmentWords.find((w) => w.text === '今日')!
    expect([kept.startMs, kept.endMs]).toEqual([keptWord.startMs, keptWord.endMs])
    const changed = tokens.find((t) => t.text.includes('元'))!
    const tenIndex = segmentWords.findIndex((w) => w.text === '天')
    expect(changed.wordFrom).toBe(tenIndex)
    expect(changed.startMs).toBeGreaterThanOrEqual(segmentWords[tenIndex].startMs)
  })
})

describe('Japanese alignment of katakana and long segments', () => {
  test('a katakana word with the long-vowel mark ー is one token at its word\'s time', () => {
    const words: SourceWord[] = [
      { text: 'コーヒー', startMs: 0, endMs: 800 },
      { text: 'を', startMs: 800, endMs: 900 },
    ]
    const tokens = alignTokens('コーヒーを', words, 0, 900)
    expect(tokens.map((t) => [t.text, t.startMs, t.endMs, t.wordFrom, t.wordTo])).toEqual([
      ['コーヒー', 0, 800, 0, 1],
      ['を', 800, 900, 1, 2],
    ])
  })

  test('a segment of 70 three-character words still aligns word by word', () => {
    const chars = Array.from('東京都今日天気晴明日雨降')
    const words: SourceWord[] = Array.from({ length: 70 }, (_, i) => ({
      text: chars[i % 12] + chars[(i + 1) % 12] + chars[(i + 2) % 12],
      startMs: i * 300,
      endMs: i * 300 + 280,
    }))
    const tokens = alignTokens(words.map((w) => w.text).join(''), words, 0, 21000)
    expect(tokens).toHaveLength(70)
    tokens.forEach((token, i) => expect([token.wordFrom, token.wordTo]).toEqual([i, i + 1]))
  })
})

describe('Soniox pieces next to Japanese', () => {
  test('a digit between Japanese pieces is a word of its own', () => {
    const { words } = run('soniox')
    const texts = words.map((w) => w.punctuatedText)
    const at = texts.indexOf('3')
    expect(at).toBeGreaterThan(0)
    expect(texts.slice(at - 1, at + 2)).toEqual(['は', '3', '時'])
  })
})

describe('Space-separated text is untouched', () => {
  test('English tokens and their word ranges are as before', () => {
    const words: SourceWord[] = [
      { text: 'Good', startMs: 0, endMs: 300 },
      { text: 'morning,', startMs: 300, endMs: 700 },
      { text: 'everyone.', startMs: 800, endMs: 1300 },
    ]
    const tokens = alignTokens('Good morning, everyone.', words, 0, 1300)
    expect(tokens.map((t) => [t.text, t.startMs, t.endMs, t.wordFrom, t.wordTo])).toEqual([
      ['Good ', 0, 300, 0, 1],
      ['morning, ', 300, 700, 1, 2],
      ['everyone.', 800, 1300, 2, 3],
    ])
  })
})

describe('Long speech without paragraph hints splits at sentence ends', () => {
  /** Soniox-shaped pieces for these sentences, one piece every 200 ms. */
  function stored(sentences: string[], pieceOf: (sentence: string) => string[]) {
    let t = 0
    const tokens = sentences.flatMap((sentence) =>
      pieceOf(sentence).map((text) => {
        const token = { text, start_ms: t, end_ms: t + 150, confidence: 0.99, speaker: '1' }
        t += 200
        return token
      })
    )
    return JSON.stringify({
      transcription: { id: 'x', status: 'completed' },
      transcript: { id: 'x', text: tokens.map((p) => p.text).join(''), tokens },
    })
  }

  const segmentsOf = (raw: string) => buildRpcPayload(getEngine('soniox').resultToWords(raw)).segments

  test('Japanese ends sentences with 。！？', () => {
    const sentences = Array.from({ length: 12 }, (_, i) =>
      ['今日は会議がありますので資料を準備してください。', '明日の天気はどうなるでしょうか？', 'それはとても楽しみです！'][i % 3]
    )
    const segments = segmentsOf(stored(sentences, (s) => Array.from(s)))

    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) expect(segment.text).toMatch(/[。！？]$/)
  })

  test('Hindi ends sentences with ।', () => {
    const sentences = Array.from({ length: 14 }, () => 'आज हमारी बैठक तीन बजे शुरू होगी और सबको समय पर आना है।')
    // Every word starts with a space, as Soniox writes them; । is a piece of its own.
    const segments = segmentsOf(stored(sentences, (s) => s.split(' ').map((w) => ` ${w}`).flatMap((w) => (w.endsWith('।') ? [w.slice(0, -1), '।'] : [w]))))

    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) {
      expect(segment.text).toMatch(/।$/)
      expect(segment.text).not.toContain('।आज')
    }
  })
})
