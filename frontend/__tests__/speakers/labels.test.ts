/** @jest-environment node */

import {
  UNKNOWN_SPEAKER_LABEL,
  genericSpeakerLabel,
  resolveSpeakerLabels,
  speakerBaseLabel,
  speakerLabelFor,
  type LabelledSpeaker,
} from '@/core/speakers/labels'

const speaker = (id: string, ordinal: number, custom_label: string | null = null): LabelledSpeaker => ({
  id,
  ordinal,
  custom_label,
})

const said = (...speakerIds: (string | null)[]) => speakerIds.map((speaker_id) => ({ speaker_id }))

describe('speakerBaseLabel', () => {
  test('a generic speaker is Speaker {ordinal}', () => {
    expect(genericSpeakerLabel(3)).toBe('Speaker 3')
    expect(speakerBaseLabel(0, null)).toBe('Speaker 0')
  })

  test('a custom label is shown exactly as stored', () => {
    expect(speakerBaseLabel(4, 'Interviewer')).toBe('Interviewer')
    expect(speakerBaseLabel(4, 'speaker 2')).toBe('speaker 2')
  })
})

describe('speakerLabelFor', () => {
  const labels = new Map([['a', 'Alex']])

  test('returns the resolved label', () => {
    expect(speakerLabelFor(labels, 'a')).toBe('Alex')
  })

  test.each([null, undefined, 'missing'])('is Unknown speaker for %p', (speakerId) => {
    expect(speakerLabelFor(labels, speakerId)).toBe(UNKNOWN_SPEAKER_LABEL)
  })

  test('the Unknown label is exactly "Unknown speaker"', () => {
    expect(UNKNOWN_SPEAKER_LABEL).toBe('Unknown speaker')
  })
})

describe('resolveSpeakerLabels', () => {
  test('distinct labels pass through untouched', () => {
    const labels = resolveSpeakerLabels(
      [speaker('a', 0), speaker('b', 1, 'Interviewer')],
      said('a', 'b', null)
    )
    expect(Object.fromEntries(labels)).toEqual({ a: 'Speaker 0', b: 'Interviewer' })
  })

  test('numbers identical labels in order of first appearance', () => {
    const labels = resolveSpeakerLabels(
      [speaker('a', 0, 'Paul'), speaker('b', 1, 'Paul'), speaker('c', 2, 'Paul')],
      said('c', 'a', 'c', 'b')
    )
    expect(Object.fromEntries(labels)).toEqual({ c: 'Paul', a: 'Paul (2)', b: 'Paul (3)' })
  })

  test('speakers with no segments follow the ones that speak, by ordinal', () => {
    const labels = resolveSpeakerLabels(
      [speaker('late', 5, 'Paul'), speaker('early', 1, 'Paul'), speaker('speaks', 9, 'Paul')],
      said('speaks')
    )
    expect(Object.fromEntries(labels)).toEqual({ speaks: 'Paul', early: 'Paul (2)', late: 'Paul (3)' })
  })

  test('a custom label equal to another speaker\'s generic label is told apart', () => {
    const labels = resolveSpeakerLabels(
      [speaker('generic', 1), speaker('renamed', 0, 'Speaker 1')],
      said('generic', 'renamed')
    )
    expect(Object.fromEntries(labels)).toEqual({ generic: 'Speaker 1', renamed: 'Speaker 1 (2)' })
  })

  test('skips a number another speaker already shows as its own label', () => {
    const labels = resolveSpeakerLabels(
      [speaker('a', 0, 'Paul'), speaker('b', 1, 'Paul'), speaker('c', 2, 'Paul (2)')],
      said('a', 'b', 'c')
    )
    expect(Object.fromEntries(labels)).toEqual({ a: 'Paul', b: 'Paul (3)', c: 'Paul (2)' })
  })

  test('compares exactly, so case variants are not numbered', () => {
    const labels = resolveSpeakerLabels(
      [speaker('a', 0, 'Alex Example'), speaker('b', 1, 'alex example')],
      said('a', 'b')
    )
    expect(Object.fromEntries(labels)).toEqual({ a: 'Alex Example', b: 'alex example' })
  })

  test('ignores segments whose speaker is unknown or not in the list', () => {
    const labels = resolveSpeakerLabels([speaker('a', 0)], said(null, 'gone', 'a'))
    expect(Object.fromEntries(labels)).toEqual({ a: 'Speaker 0' })
  })

  test('is empty for a transcript with no speakers', () => {
    expect(resolveSpeakerLabels([], said(null)).size).toBe(0)
  })
})
