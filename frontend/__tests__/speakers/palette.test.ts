/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'
import { resolveSpeakerPresentation } from '@/core/speakers/labels'
import {
  leastUsedSpeakerColor,
  resolveTranscriptColors,
  speakerInitials,
  SPEAKER_COLORS,
  SPEAKER_COLOR_FALLBACK,
} from '@/lib/speakers/palette'

test('the palette matches speaker_palette() in the database, in allocation order', () => {
  const migration = fs.readFileSync(path.resolve(__dirname,
    '../../../infra/supabase/migrations/20260924120000_people_editor.sql'), 'utf8')
  const body = migration.match(/FUNCTION public\.speaker_palette\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]/)
  expect(body).not.toBeNull()
  expect([...body![1].matchAll(/'(#[0-9A-F]{6})'/gi)].map((match) => match[1])).toEqual([...SPEAKER_COLORS])
})

test('linked people claim colours in first appearance order while local voices stay grey', () => {
  const presentation = resolveSpeakerPresentation([
    { id: 'a', ordinal: 0, custom_label: null, person_id: 'p1' },
    { id: 'b', ordinal: 1, custom_label: null, person_id: 'p2' },
    { id: 'c', ordinal: 2, custom_label: null, person_id: 'p1' },
    { id: 'local', ordinal: 3, custom_label: null, person_id: null },
  ], [{ speaker_id: 'b' }, { speaker_id: 'local' }, { speaker_id: 'a' }, { speaker_id: 'c' }], [
    { id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Blair' },
  ])
  const colors = resolveTranscriptColors(presentation, [
    { id: 'p1', preferred_color: SPEAKER_COLORS[0] },
    { id: 'p2', preferred_color: SPEAKER_COLORS[0] },
  ])
  expect(colors.get('b')).toBe(SPEAKER_COLORS[0])
  expect(colors.get('a')).toBe(SPEAKER_COLORS[1])
  expect(colors.get('c')).toBe(SPEAKER_COLORS[1])
  expect(colors.get('local')).toBe(SPEAKER_COLOR_FALLBACK)
})

describe('leastUsedSpeakerColor', () => {
  test('a first person takes the first palette colour', () => {
    expect(leastUsedSpeakerColor([])).toBe(SPEAKER_COLORS[0])
  })

  test('takes the least used colour, earliest in the palette on a tie', () => {
    const used = SPEAKER_COLORS.map((preferred_color) => ({ preferred_color }))
    expect(leastUsedSpeakerColor([...used, { preferred_color: SPEAKER_COLORS[0] }])).toBe(SPEAKER_COLORS[1])
    expect(leastUsedSpeakerColor(used.slice(0, 3))).toBe(SPEAKER_COLORS[3])
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
