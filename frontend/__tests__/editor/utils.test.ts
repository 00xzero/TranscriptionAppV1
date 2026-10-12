import {
  isUnicodeWordChar,
  groupSourceWords,
  createSegmentLocator,
  findCurrentTokenIndex,
  formatTranscriptDate,
  getNextWaveformCollapsed,
} from '../../app/editor/[id]/utils'

describe('isUnicodeWordChar', () => {
  it('returns true for ASCII word characters', () => {
    expect(isUnicodeWordChar('a')).toBe(true)
    expect(isUnicodeWordChar('Z')).toBe(true)
    expect(isUnicodeWordChar('0')).toBe(true)
    expect(isUnicodeWordChar('_')).toBe(true)
  })

  it('returns false for ASCII non-word characters', () => {
    expect(isUnicodeWordChar(' ')).toBe(false)
    expect(isUnicodeWordChar('!')).toBe(false)
    expect(isUnicodeWordChar('-')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isUnicodeWordChar('')).toBe(false)
  })

  it('returns true for non-cased scripts (CJK, Hebrew, Arabic)', () => {
    expect(isUnicodeWordChar('\u4E00')).toBe(true) // CJK
    expect(isUnicodeWordChar('\u05D0')).toBe(true) // Hebrew Alef
    expect(isUnicodeWordChar('\u0627')).toBe(true) // Arabic Alif
    expect(isUnicodeWordChar('\u3042')).toBe(true) // Hiragana
  })

  it('returns true for combining marks', () => {
    expect(isUnicodeWordChar('\u0300')).toBe(true) // grave accent
    expect(isUnicodeWordChar('\u036F')).toBe(true) // last combining mark
  })

  it('returns true for cased Unicode letters', () => {
    expect(isUnicodeWordChar('\u00E9')).toBe(true) // e-acute
    expect(isUnicodeWordChar('\u00DF')).toBe(true) // German eszett
  })
})

const SEG_A = '11111111-1111-4111-8111-111111111111'
const SEG_B = '22222222-2222-4222-8222-222222222222'
let wordSeq = 0
function wordRow(overrides: Record<string, unknown>) {
  wordSeq++
  return {
    id: `00000000-0000-4000-8000-${String(wordSeq).padStart(12, '0')}`,
    segment_id: SEG_A,
    start_ms: 0,
    end_ms: 100,
    text: 'word',
    punctuated_text: null,
    order_index: 0,
    ...overrides,
  }
}

describe('groupSourceWords', () => {
  let warn: jest.SpyInstance
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => warn.mockRestore())

  it('groups rows per segment in spoken order, preferring the punctuated text', () => {
    const grouped = groupSourceWords([
      wordRow({ segment_id: SEG_B, order_index: 0, text: 'again', punctuated_text: 'Again.', start_ms: 900, end_ms: 1200 }),
      wordRow({ order_index: 1, text: 'world', punctuated_text: 'world.', start_ms: 300, end_ms: 600 }),
      wordRow({ order_index: 0, text: 'hello', punctuated_text: 'Hello', start_ms: 0, end_ms: 300 }),
      wordRow({ order_index: 2, text: 'ok', punctuated_text: null, start_ms: 600, end_ms: 700 }),
    ])
    expect(grouped.get(SEG_A)).toEqual([
      { text: 'Hello', startMs: 0, endMs: 300 },
      { text: 'world.', startMs: 300, endMs: 600 },
      { text: 'ok', startMs: 600, endMs: 700 },
    ])
    expect(grouped.get(SEG_B)).toEqual([{ text: 'Again.', startMs: 900, endMs: 1200 }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops rows with impossible timing or a bad shape and keeps the rest', () => {
    const grouped = groupSourceWords([
      wordRow({ order_index: 0, start_ms: 0, end_ms: 100, text: 'kept' }),
      wordRow({ order_index: 1, start_ms: 500, end_ms: 400 }),
      wordRow({ order_index: 2, start_ms: -10, end_ms: 50 }),
      wordRow({ order_index: 3, start_ms: '200', end_ms: 300 }),
      wordRow({ order_index: 4, start_ms: Number.NaN, end_ms: 300 }),
      wordRow({ order_index: 5, segment_id: undefined }),
      null,
    ])
    expect(grouped.get(SEG_A)).toEqual([{ text: 'kept', startMs: 0, endMs: 100 }])
    expect(grouped.size).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('dropped 6 word row(s)')
  })
})

describe('createSegmentLocator', () => {
  const locate = createSegmentLocator([
    { id: 'a', start_ms: 0, end_ms: 1000 },
    { id: 'b', start_ms: 1000, end_ms: 2000 },
    { id: 'c', start_ms: 5000, end_ms: 6000 },
  ])

  it('finds the segment containing the time', () => {
    expect(locate(0)).toBe('a')
    expect(locate(999)).toBe('a')
    expect(locate(1500)).toBe('b')
    expect(locate(5999)).toBe('c')
  })

  it('gives a boundary shared by two segments to the one starting there', () => {
    expect(locate(1000)).toBe('b')
  })

  it('keeps a segment current through the silence after it', () => {
    expect(locate(2000)).toBe('b')
    expect(locate(4999)).toBe('b')
    expect(locate(6000)).toBe('c')
    expect(locate(9000)).toBe('c')
  })

  it('stays on the earliest segment containing the time where segments overlap', () => {
    const overlapping = createSegmentLocator([
      { id: 'long', start_ms: 0, end_ms: 10000 },
      { id: 'short1', start_ms: 2000, end_ms: 3000 },
      { id: 'short2', start_ms: 4000, end_ms: 5000 },
      { id: 'after', start_ms: 12000, end_ms: 13000 },
    ])
    expect(overlapping(2500)).toBe('long')
    expect(overlapping(4500)).toBe('long')
    // In the silence after it, the segment heard last stays current.
    expect(overlapping(11000)).toBe('long')
    expect(overlapping(12000)).toBe('after')
  })

  it('has no current segment before the first one starts', () => {
    expect(createSegmentLocator([{ id: 'x', start_ms: 500, end_ms: 900 }])(100)).toBeUndefined()
    expect(createSegmentLocator([])(100)).toBeUndefined()
  })
})

describe('findCurrentTokenIndex', () => {
  const tokens = [{ startMs: 100 }, { startMs: 400 }, { startMs: 400 }, { startMs: 900 }]

  it('is -1 before the first token', () => {
    expect(findCurrentTokenIndex(tokens, 99)).toBe(-1)
  })

  it('keeps the last started token current through the pause after it', () => {
    expect(findCurrentTokenIndex(tokens, 100)).toBe(0)
    expect(findCurrentTokenIndex(tokens, 399)).toBe(0)
    expect(findCurrentTokenIndex(tokens, 5000)).toBe(3)
  })

  it('makes the last of tokens sharing a start time current', () => {
    expect(findCurrentTokenIndex(tokens, 400)).toBe(2)
    expect(findCurrentTokenIndex(tokens, 899)).toBe(2)
  })
})

describe('formatTranscriptDate', () => {
  it('formats a date string', () => {
    const result = formatTranscriptDate('2023-10-24T12:00:00Z')
    expect(result).toMatch(/OCT\s+24,\s+2023/)
  })

  it('returns empty string for null', () => {
    expect(formatTranscriptDate(null)).toBe('')
  })
})

describe('getNextWaveformCollapsed', () => {
  it('uses a lower expand threshold once the waveform is already collapsed', () => {
    expect(getNextWaveformCollapsed(false, 190, 300)).toBe(true)
    expect(getNextWaveformCollapsed(true, 190, 300)).toBe(true)
    expect(getNextWaveformCollapsed(true, 100, 300)).toBe(false)
  })
})
