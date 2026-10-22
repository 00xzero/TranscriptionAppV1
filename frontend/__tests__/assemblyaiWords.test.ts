/** @jest-environment node */

/**
 * AssemblyAI results → our words and segments. The fixtures are real
 * AssemblyAI answers (EU servers, 2026-10-22), with ids and links replaced:
 * two English speakers with fillers, masked profanity and key terms; Japanese,
 * which comes as pieces; English with Japanese inside it; speakers off;
 * Russian, made by Universal-2; and a failed transcript.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { assemblyaiResultToWords } from '@/core/transcription/engines/assemblyai-words'
import type { NormalizedWord } from '@/core/transcript/segment-builder'
import { buildRpcPayload } from '@/lib/transcription/segments-payload'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', 'assemblyai', `${name}.json`), 'utf8')
}

function textOf(name: string): string {
  return JSON.parse(fixture(name)).text
}

/** The words written back out the way they say they join. */
function rejoin(words: NormalizedWord[]): string {
  return words.map((word, index) => (index === 0 || word.joinsPrevious ? '' : ' ') + word.punctuatedText).join('')
}

function stored(text: string, words: Array<{ text: string; speaker?: string | null }>): string {
  return JSON.stringify({
    id: 'aai-transcript-1',
    status: 'completed',
    text,
    words: words.map((word, index) => ({ start: index * 100, end: index * 100 + 90, confidence: 0.9, speaker: null, ...word })),
  })
}

describe('assemblyaiResultToWords', () => {
  test.each(['two-speakers', 'japanese', 'mixed-scripts', 'speakers-off', 'russian'])(
    '%s: the words write back out to exactly the text AssemblyAI wrote',
    (name) => {
      expect(rejoin(assemblyaiResultToWords(fixture(name)).words)).toBe(textOf(name))
    }
  )

  test('two speakers: A and B become 0 and 1, fillers and masked words kept, times as given', () => {
    const { words, model } = assemblyaiResultToWords(fixture('two-speakers'))

    expect(model).toBe('universal-3-5-pro')
    expect(words[0]).toEqual({
      text: 'so',
      punctuatedText: 'So,',
      startMs: 16,
      endMs: 337,
      confidence: expect.any(Number),
      speaker: 0,
      speakerConfidence: null,
      paragraphIndex: null,
      sentenceEnd: false,
    })
    expect(new Set(words.map((word) => word.speaker))).toEqual(new Set([0, 1]))
    expect(words.find((word) => word.punctuatedText === 'Honestly,')?.speaker).toBe(1)
    expect(words.map((word) => word.punctuatedText)).toEqual(expect.arrayContaining(['um,', 'uh,', 'd***', 'Qwyntessa', 'Brixtonne']))
    expect(words.some((word) => word.joinsPrevious)).toBe(false)
  })

  test('Japanese pieces rejoin with no spaces, in segments and all', () => {
    const { words } = assemblyaiResultToWords(fixture('japanese'))
    expect(words.slice(0, 3).map((word) => word.punctuatedText)).toEqual(['こ', 'ん', 'にちは。'])
    expect(words.slice(1).every((word) => word.joinsPrevious)).toBe(true)

    const { segments } = buildRpcPayload(assemblyaiResultToWords(fixture('japanese')))
    expect(segments.map((segment) => segment.text).join('')).toBe(textOf('japanese'))
    for (const segment of segments) expect(segment.text).not.toMatch(/\s/)
  })

  test('Japanese inside English keeps the spaces around it and none inside it, in the saved segments', () => {
    const { segments } = buildRpcPayload(assemblyaiResultToWords(fixture('mixed-scripts')))
    const texts = segments.map((segment) => segment.text)

    expect(texts.join(' ')).toContain('The word "天気" means weather, and the city name "東京" is Tokyo.')
    expect(texts.join(' ')).toContain('サーバーの費用が高すぎるので、来月から新しいプランに変更する予定です。')
    expect(texts.join(' ')).not.toContain('word"天')
    expect(texts.join(' ')).not.toContain('"means')
  })

  test('without speakers asked for, no word has one', () => {
    const { words } = assemblyaiResultToWords(fixture('speakers-off'))
    expect(words.length).toBeGreaterThan(0)
    expect(words.every((word) => word.speaker === null)).toBe(true)
  })

  test('Russian is made by Universal-2 and keeps its fillers', () => {
    const { words, model } = assemblyaiResultToWords(fixture('russian'))
    expect(model).toBe('universal-2')
    expect(words.map((word) => word.text)).toEqual(expect.arrayContaining(['ээ', 'эм']))
  })

  test('a failed transcript parses, with no words, no text and no model', () => {
    expect(assemblyaiResultToWords(fixture('error'))).toEqual({ words: [], fallbackText: '', model: null })
  })

  test('a word missing from the text gets a space, unless both sides are written without spaces', () => {
    const { words } = assemblyaiResultToWords(stored('Hello there', [{ text: 'Hello' }, { text: 'world' }, { text: '東' }, { text: '京' }]))
    expect(words.map((word) => !!word.joinsPrevious)).toEqual([false, false, false, true])
  })

  test('a later copy of a word far ahead is not taken for it', () => {
    const text = `Yes ${'x'.repeat(40)} yes`
    const { words } = assemblyaiResultToWords(stored(text, [{ text: 'Yes' }, { text: 'no' }, { text: 'yes' }]))
    expect(words.map((word) => !!word.joinsPrevious)).toEqual([false, false, false])
  })

  test('refuses a result that is not AssemblyAI-shaped', () => {
    expect(() => assemblyaiResultToWords(JSON.stringify({ results: {} }))).toThrow('Invalid AssemblyAI result structure')
  })

  test('the two-speaker result becomes these segments', () => {
    const payload = buildRpcPayload(assemblyaiResultToWords(fixture('two-speakers')))
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
