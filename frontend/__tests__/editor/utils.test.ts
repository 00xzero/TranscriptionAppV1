import {
  isUnicodeWordChar,
  computeWordsForSegment,
  computeWordsForSegments,
  formatProjectDate,
  formatDurationHHMMSS,
  getNextWaveformCollapsed,
  msToTimestamp,
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

describe('computeWordsForSegment', () => {
  it('splits text into timed words', () => {
    const seg = { id: 's1', start_ms: 0, end_ms: 3000, text: 'hello world' }
    const words = computeWordsForSegment(seg)
    expect(words).toHaveLength(2)
    expect(words[0].text).toBe('hello ')
    expect(words[1].text).toBe('world')
    expect(words[0].key).toBe('s1:0')
    expect(words[1].key).toBe('s1:2')
  })

  it('handles single word', () => {
    const seg = { id: 's1', start_ms: 1000, end_ms: 2000, text: 'hello' }
    const words = computeWordsForSegment(seg)
    expect(words).toHaveLength(1)
    expect(words[0].text).toBe('hello')
    expect(words[0].start_ms).toBe(1000)
    expect(words[0].end_ms).toBe(2000)
  })

  it('handles empty text', () => {
    const seg = { id: 's1', start_ms: 0, end_ms: 1000, text: '' }
    const words = computeWordsForSegment(seg)
    expect(words).toHaveLength(0)
  })

  it('appends whitespace to preceding word', () => {
    const seg = { id: 's1', start_ms: 0, end_ms: 3000, text: 'a  b' }
    const words = computeWordsForSegment(seg)
    expect(words[0].text).toBe('a  ')
    expect(words[1].text).toBe('b')
  })
})

describe('computeWordsForSegments', () => {
  it('adds words array to each segment', () => {
    const segs = [
      { id: 's1', start_ms: 0, end_ms: 1000, text: 'hello' },
      { id: 's2', start_ms: 1000, end_ms: 2000, text: 'world' },
    ]
    const result = computeWordsForSegments(segs)
    expect(result).toHaveLength(2)
    expect(result[0].words).toHaveLength(1)
    expect(result[1].words).toHaveLength(1)
    expect(result[0].id).toBe('s1')
  })
})

describe('formatProjectDate', () => {
  it('formats a date string', () => {
    const result = formatProjectDate('2023-10-24T12:00:00Z')
    expect(result).toMatch(/OCT\s+24,\s+2023/)
  })

  it('returns empty string for null', () => {
    expect(formatProjectDate(null)).toBe('')
  })
})

describe('formatDurationHHMMSS', () => {
  it('formats seconds as HH:MM:SS', () => {
    expect(formatDurationHHMMSS(3661)).toBe('01:01:01')
    expect(formatDurationHHMMSS(0)).toBe('00:00:00')
    expect(formatDurationHHMMSS(59)).toBe('00:00:59')
    expect(formatDurationHHMMSS(3600)).toBe('01:00:00')
  })

  it('returns empty string for null', () => {
    expect(formatDurationHHMMSS(null)).toBe('')
  })
})

describe('msToTimestamp', () => {
  it('converts milliseconds to HH:MM:SS', () => {
    expect(msToTimestamp(0)).toBe('00:00:00')
    expect(msToTimestamp(1000)).toBe('00:00:01')
    expect(msToTimestamp(61000)).toBe('00:01:01')
    expect(msToTimestamp(3661000)).toBe('01:01:01')
  })

  it('floors partial seconds', () => {
    expect(msToTimestamp(1500)).toBe('00:00:01')
    expect(msToTimestamp(999)).toBe('00:00:00')
  })
})

describe('getNextWaveformCollapsed', () => {
  it('uses a lower expand threshold once the waveform is already collapsed', () => {
    expect(getNextWaveformCollapsed(false, 190, 300)).toBe(true)
    expect(getNextWaveformCollapsed(true, 190, 300)).toBe(true)
    expect(getNextWaveformCollapsed(true, 100, 300)).toBe(false)
  })
})
