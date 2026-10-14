import {
  applyRejoinSegments,
  applyRejoinWords,
  applySplitWords,
  upsertSegments,
} from '@/app/editor/[id]/hooks/segmentSplit'
import type { EditorWord, Seg, WordsBySegment } from '@/app/editor/[id]/types'

const stamp = '2026-10-13T00:00:00Z'
const seg = (id: string, start_ms: number, end_ms: number, text: string, revision = 0): Seg => ({
  id, transcript_id: 't1', speaker_id: 'sp1', diarization_index: 0, start_ms, end_ms, text,
  is_edited: false, is_filler: false, algo_version: 'test', revision, created_at: stamp, updated_at: stamp,
})
const word = (id: string, startMs: number): EditorWord => ({ id, text: id, startMs, endMs: startMs + 100 })

const before = seg('a', 0, 900, 'Before.')
const whole = seg('b', 1000, 2000, 'One two. Three four.')
const after = seg('c', 2100, 3000, 'After.')
const wholeWords = [word('one', 1000), word('two', 1200), word('three', 1500), word('four', 1800)]
const words: WordsBySegment = new Map([['b', wholeWords]])

// As split_segment returns them.
const firstHalf = { ...seg('b', 1000, 1300, 'One two.', 1), is_edited: true }
const secondHalf = { ...seg('n', 1500, 2000, 'Three four.'), is_edited: true }
const rows = [firstHalf, secondHalf] as const

describe('applying a confirmed split', () => {
  it('puts both halves in place, the new one straight after the original', () => {
    const segments = upsertSegments([before, whole, after], rows)
    expect(segments.map((s) => [s.id, s.text])).toEqual([
      ['a', 'Before.'], ['b', 'One two.'], ['n', 'Three four.'], ['c', 'After.'],
    ])
  })

  it('divides the captured words between the halves', () => {
    const divided = applySplitWords(words, rows, wholeWords, 2)
    expect(divided.get('b')!.map((w) => w.id)).toEqual(['one', 'two'])
    expect(divided.get('n')!.map((w) => w.id)).toEqual(['three', 'four'])
  })

  it('changes nothing when applied twice, or after a reload already shows it', () => {
    const once = upsertSegments([before, whole, after], rows)
    expect(upsertSegments(once, rows)).toEqual(once)

    const onceWords = applySplitWords(words, rows, wholeWords, 2)
    expect(applySplitWords(onceWords, rows, wholeWords, 2)).toEqual(onceWords)

    // A reload has shown the split already, words and all: still the same.
    const reloaded = [before, firstHalf, secondHalf, after]
    expect(upsertSegments(reloaded, rows)).toEqual(once)
    const reloadedWords: WordsBySegment = new Map([['b', wholeWords.slice(0, 2)], ['n', wholeWords.slice(2)]])
    expect(applySplitWords(reloadedWords, rows, wholeWords, 2)).toEqual(onceWords)
  })
})

describe('applying a confirmed rejoin', () => {
  const split = upsertSegments([before, whole, after], rows)
  const splitWords = applySplitWords(words, rows, wholeWords, 2)
  const joined = { ...seg('b', 1000, 2000, 'One two. Three four.', 2), is_edited: true }
  const captured = { first: splitWords.get('b')!, next: splitWords.get('n')! }

  it('round-trips back to the original segment and words', () => {
    const segments = applyRejoinSegments(split, joined, 'n')
    expect(segments.map((s) => [s.id, s.start_ms, s.end_ms, s.text])).toEqual([
      ['a', 0, 900, 'Before.'], ['b', 1000, 2000, 'One two. Three four.'], ['c', 2100, 3000, 'After.'],
    ])
    const rejoinedWords = applyRejoinWords(splitWords, 'b', 'n', captured)
    expect(rejoinedWords.get('b')).toEqual(wholeWords)
    expect(rejoinedWords.has('n')).toBe(false)
  })

  it('changes nothing when applied twice', () => {
    const once = applyRejoinSegments(split, joined, 'n')
    expect(applyRejoinSegments(once, joined, 'n')).toEqual(once)
    const onceWords = applyRejoinWords(splitWords, 'b', 'n', captured)
    expect(applyRejoinWords(onceWords, 'b', 'n', captured)).toEqual(onceWords)
  })
})

describe('upsertSegments', () => {
  it('places a new row by start time, then id, as the database orders them', () => {
    const tie = seg('bb', 1000, 1100, 'tie')
    expect(upsertSegments([before, whole, after], [tie]).map((s) => s.id)).toEqual(['a', 'b', 'bb', 'c'])
    expect(upsertSegments([before, whole, after], [seg('0', 1000, 1100, 'tie')]).map((s) => s.id)).toEqual(['a', '0', 'b', 'c'])
  })
})
