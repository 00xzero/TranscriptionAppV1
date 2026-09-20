/** @jest-environment node */

import {
  buildSpeakerColorMap,
  resolveSpeakerColor,
  speakerInitials,
  speakerPaletteColor,
  SPEAKER_COLORS,
  SPEAKER_COLOR_FALLBACK,
} from '@/lib/speakers/palette'

describe('speakerPaletteColor', () => {
  test('returns the palette entry at a position', () => {
    expect(speakerPaletteColor(0)).toBe(SPEAKER_COLORS[0])
    expect(speakerPaletteColor(3)).toBe(SPEAKER_COLORS[3])
  })

  test('wraps past the end of the palette', () => {
    expect(speakerPaletteColor(SPEAKER_COLORS.length)).toBe(SPEAKER_COLORS[0])
    expect(speakerPaletteColor(SPEAKER_COLORS.length + 2)).toBe(SPEAKER_COLORS[2])
    expect(speakerPaletteColor(SPEAKER_COLORS.length * 3 + 1)).toBe(SPEAKER_COLORS[1])
  })

  // Total rather than returning undefined: a bad index must still paint a circle.
  test.each([-1, 1.5, NaN, Infinity])('falls back for the out-of-band index %p', (index) => {
    expect(speakerPaletteColor(index)).toBe(SPEAKER_COLOR_FALLBACK)
  })
})

describe('resolveSpeakerColor', () => {
  test('prefers a stored color over the palette position', () => {
    expect(resolveSpeakerColor({ color: '#FF0000' }, 0)).toBe('#FF0000')
  })

  test('uses the palette position when no color is stored', () => {
    expect(resolveSpeakerColor({ color: null }, 1)).toBe(SPEAKER_COLORS[1])
  })

  test('falls back without a speaker or without a position', () => {
    expect(resolveSpeakerColor(undefined, 0)).toBe(SPEAKER_COLOR_FALLBACK)
    expect(resolveSpeakerColor(null, 0)).toBe(SPEAKER_COLOR_FALLBACK)
    expect(resolveSpeakerColor({ color: null }, null)).toBe(SPEAKER_COLOR_FALLBACK)
  })

  // The editor has always treated a whitespace color as stored; trimming here
  // would silently repaint those speakers grey.
  test('treats a whitespace color as stored, and an empty one as absent', () => {
    expect(resolveSpeakerColor({ color: '   ' }, 0)).toBe('   ')
    expect(resolveSpeakerColor({ color: '' }, 0)).toBe(SPEAKER_COLORS[0])
  })
})

describe('buildSpeakerColorMap', () => {
  test('maps array position to palette position, honouring stored colors', () => {
    const map = buildSpeakerColorMap([
      { id: 'a', color: null },
      { id: 'b', color: '#123456' },
      { id: 'c', color: null },
    ])

    expect(map.get('a')).toBe(SPEAKER_COLORS[0])
    expect(map.get('b')).toBe('#123456')
    // 'b' still occupies palette slot 1, so 'c' is slot 2 — a stored color must
    // not shift the speakers after it.
    expect(map.get('c')).toBe(SPEAKER_COLORS[2])
  })

  test('wraps for a transcript with more speakers than palette entries', () => {
    const speakers = Array.from({ length: SPEAKER_COLORS.length + 1 }, (_, index) => ({
      id: `speaker-${index}`,
      color: null,
    }))

    const map = buildSpeakerColorMap(speakers)
    expect(map.get(`speaker-${SPEAKER_COLORS.length}`)).toBe(SPEAKER_COLORS[0])
  })

  test('is empty for no speakers', () => {
    expect(buildSpeakerColorMap([]).size).toBe(0)
  })
})

describe('speakerInitials', () => {
  test.each([
    ['Kate', 'K'],
    ['John Smith', 'JS'],
    ['Speaker 1', 'S1'],
    ['kate', 'K'],
    ['  John   Smith  ', 'JS'],
    ['Ada Byron Lovelace', 'AB'],
  ])('renders %p as %p', (label, expected) => {
    expect(speakerInitials(label)).toBe(expected)
  })

  test.each(['', '   ', '\t\n'])('renders the blank label %p as a question mark', (label) => {
    expect(speakerInitials(label)).toBe('?')
  })

  // Array.from takes a whole code point, so a non-BMP label does not render as
  // half a surrogate pair.
  test('keeps an astral first character intact', () => {
    expect(speakerInitials('😀 Smith')).toBe('😀S')
  })
})
