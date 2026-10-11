/** @jest-environment node */

import { UNKNOWN_IDENTITY_KEY, resolveSpeakerPresentation, type LabelledSpeaker } from '@/core/speakers/labels'
import { summariseSpeakers, type TalkSegment } from '@/core/speakers/talk'

const speaker = (id: string, ordinal: number, person_id: string | null = null): LabelledSpeaker => ({
  id, ordinal, custom_label: null, person_id,
})

let nextId = 0
const seg = (speaker_id: string | null, start_ms: number, end_ms: number, text = 'words'): TalkSegment => ({
  id: `seg-${nextId++}`, speaker_id, start_ms, end_ms, text,
})

function summarise(speakers: LabelledSpeaker[], segments: TalkSegment[], people: { id: string; name: string }[] = []) {
  return summariseSpeakers(segments, resolveSpeakerPresentation(speakers, segments, people))
}

beforeEach(() => { nextId = 0 })

describe('summariseSpeakers', () => {
  test('shares are each identity’s fraction of all segment time, largest first', () => {
    const result = summarise([speaker('a', 1), speaker('b', 2)], [
      seg('a', 0, 1000), seg('b', 1000, 4000),
    ])
    expect(result.totalMs).toBe(4000)
    expect(result.identities.map((identity) => [identity.key, identity.share])).toEqual([
      ['speaker:b', 0.75],
      ['speaker:a', 0.25],
    ])
  })

  test('a segment that ends before it starts counts as no time', () => {
    const result = summarise([speaker('a', 1), speaker('b', 2)], [
      seg('a', 5000, 4000), seg('b', 0, 1000),
    ])
    expect(result.totalMs).toBe(1000)
    expect(result.identities.find((identity) => identity.key === 'speaker:a')?.speakingMs).toBe(0)
  })

  test('no time at all gives every identity a zero share', () => {
    const result = summarise([speaker('a', 1)], [seg('a', 100, 100)])
    expect(result.totalMs).toBe(0)
    expect(result.identities[0].share).toBe(0)
  })

  test('turns are runs of consecutive segments, starting at their first segment', () => {
    const segments = [seg('a', 0, 1, 'One'), seg('a', 1, 2, 'two.'), seg('b', 2, 3), seg('a', 3, 4, 'Three')]
    const result = summarise([speaker('a', 1), speaker('b', 2)], segments)
    const a = result.identities.find((identity) => identity.key === 'speaker:a')!
    expect(a.turns.map((turn) => [turn.segmentId, turn.segmentIds, turn.startMs, turn.excerpt])).toEqual([
      ['seg-0', ['seg-0', 'seg-1'], 0, 'One two.'],
      ['seg-3', ['seg-3'], 3, 'Three'],
    ])
  })

  test('two voices linked to one person are one identity, and one turn when adjacent', () => {
    const result = summarise(
      [speaker('a', 1, 'p'), speaker('b', 2, 'p')],
      [seg('a', 0, 1000), seg('b', 1000, 2000)],
      [{ id: 'p', name: 'Alex' }]
    )
    expect(result.identities).toHaveLength(1)
    expect(result.identities[0]).toMatchObject({ key: 'person:p', speakerIds: ['a', 'b'], share: 1 })
    expect(result.identities[0].turns).toHaveLength(1)
  })

  test('unassigned segments are one Unknown identity', () => {
    const result = summarise([speaker('a', 1)], [seg(null, 0, 500), seg('a', 500, 600), seg(null, 600, 700)])
    const unknown = result.identities.find((identity) => identity.key === UNKNOWN_IDENTITY_KEY)!
    expect(unknown).toMatchObject({ speakerIds: [null], speakingMs: 600 })
    expect(unknown.turns).toHaveLength(2)
  })

  test('the excerpt is capped and skips blank text', () => {
    const long = 'x'.repeat(300)
    const result = summarise([speaker('a', 1)], [seg('a', 0, 1, '  '), seg('a', 1, 2, long)])
    expect(result.identities[0].turns[0].excerpt).toHaveLength(240)
  })

  test('an empty transcript has no identities', () => {
    expect(summarise([], [])).toEqual({ totalMs: 0, identities: [] })
  })
})
