/** @jest-environment node */

import type { DirectoryPerson, MergePreview, PeopleDirectory } from '@/contracts/db'
import {
  appearanceTotals,
  describeMergeVoice,
  filterDirectory,
  matchesPersonSearch,
  mergeDirectoryPeople,
  namesakesOf,
  NO_ORGANISATION,
  sortDirectory,
  talkShare,
} from '@/core/people/directory'
import { exactByName, matchByName } from '@/core/names'

const person = (overrides: Partial<DirectoryPerson> & { id: string; name: string }): DirectoryPerson => ({
  user_id: 'u1', organisation_id: null, organisation_name: null, preferred_color: '#4F638C', hidden: false,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', transcript_count: 0, last_seen_at: null,
  ...overrides,
})

const alex = person({ id: 'a', name: 'Alex Morgan', organisation_id: 'acme', organisation_name: 'ACME',
  transcript_count: 2, last_seen_at: '2026-09-10T00:00:00Z' })
const blair = person({ id: 'b', name: 'blair', transcript_count: 1, last_seen_at: '2026-09-20T00:00:00Z' })
const casey = person({ id: 'c', name: 'Casey', hidden: true, organisation_id: 'globex', organisation_name: 'Globex',
  transcript_count: 1, last_seen_at: '2026-09-15T00:00:00Z' })
// Never seen, but created after everyone's last appearance.
const drew = person({ id: 'd', name: 'Drew', created_at: '2026-09-25T00:00:00Z' })
const everyone = [alex, blair, casey, drew]

describe('confirmed directory merges', () => {
  const metadata = (person: DirectoryPerson) => ({ person_id: person.id, name: person.name,
    preferred_color: person.preferred_color, organisation_id: person.organisation_id,
    organisation_name: person.organisation_name })
  const directory: PeopleDirectory = {
    people: everyone,
    organisations: [
      { id: 'acme', name: 'ACME', user_id: 'u1', created_at: '', updated_at: '', person_count: 1 },
      { id: 'globex', name: 'Globex', user_id: 'u1', created_at: '', updated_at: '', person_count: 1 },
    ],
  }

  test('removes source identities and counts each overlapping transcript once, keeping the newest appearance', () => {
    const preview: MergePreview = {
      survivor: metadata(alex), survivor_transcript_ids: ['x', 'y'],
      people: [
        { ...metadata(blair), transcripts: [
          { transcript_id: 'y', title: null, created_at: '2026-09-10T00:00:00Z', voices: [] },
          { transcript_id: 'z', title: null, created_at: '2026-09-30T00:00:00Z', voices: [] },
        ] },
        { ...metadata(casey), transcripts: [
          { transcript_id: 'z', title: null, created_at: '2026-09-30T00:00:00Z', voices: [] },
          { transcript_id: 'w', title: null, created_at: '2026-09-29T00:00:00Z', voices: [] },
        ] },
      ],
    }

    const merged = mergeDirectoryPeople(directory, { ...alex, updated_at: '2026-10-10T00:00:00Z' }, preview)

    expect(merged.people.map((person) => person.id)).toEqual(['a', 'd'])
    expect(merged.people[0]).toMatchObject({
      organisation_id: 'acme', organisation_name: 'ACME', transcript_count: 4,
      last_seen_at: '2026-09-30T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
    })
    expect(merged.organisations.map((organisation) => organisation.person_count)).toEqual([1, 0])
    expect(merged.people[1]).toEqual(drew)
    expect(directory.people).toEqual(everyone)
    expect(directory.organisations[1].person_count).toBe(1)
  })

  test('silent source links add no appearances or last-seen date', () => {
    const preview: MergePreview = {
      survivor: metadata(alex), survivor_transcript_ids: ['x', 'y'],
      people: [{ ...metadata(casey), transcripts: [] }],
    }
    const merged = mergeDirectoryPeople(directory, alex, preview)
    expect(merged.people.find((person) => person.id === alex.id)).toMatchObject({
      transcript_count: 2, last_seen_at: alex.last_seen_at,
    })
    expect(merged.people.some((person) => person.id === casey.id)).toBe(false)

    const empty = mergeDirectoryPeople(directory, alex, { ...preview, survivor_transcript_ids: [] })
    expect(empty.people.find((person) => person.id === alex.id)).toMatchObject({
      transcript_count: 0, last_seen_at: null,
    })
  })
})

describe('search (spec §4)', () => {
  test.each([
    ['alex', true], ['  MORGAN ', true], ['ex mo', true], ['acme', true], ['cme', true],
    ['globex', false], ['zed', false], ['', true], ['   ', true],
  ])('%j matches Alex Morgan at ACME: %s', (query, expected) => {
    expect(matchesPersonSearch(alex, query)).toBe(expected)
  })

  test('a person without an organisation matches on name only', () => {
    expect(matchesPersonSearch(blair, 'acme')).toBe(false)
    expect(matchesPersonSearch(blair, 'BLA')).toBe(true)
  })
})

describe('filterDirectory', () => {
  const filter = (options: Partial<Parameters<typeof filterDirectory>[1]>) =>
    filterDirectory(everyone, { query: '', organisations: [], showHidden: false, ...options })
      .map((entry) => entry.id)

  test('hidden people are left out unless Show hidden is on', () => {
    expect(filter({})).toEqual(['a', 'b', 'd'])
    expect(filter({ showHidden: true })).toEqual(['a', 'b', 'c', 'd'])
  })

  test('filters by one organisation, or by none', () => {
    expect(filter({ organisations: ['acme'] })).toEqual(['a'])
    expect(filter({ organisations: ['globex'] })).toEqual([])
    expect(filter({ organisations: ['globex'], showHidden: true })).toEqual(['c'])
    expect(filter({ organisations: [NO_ORGANISATION] })).toEqual(['b', 'd'])
  })

  test('several selected show anyone in any of them', () => {
    expect(filter({ organisations: ['acme', 'globex'], showHidden: true })).toEqual(['a', 'c'])
    expect(filter({ organisations: ['acme', NO_ORGANISATION] })).toEqual(['a', 'b', 'd'])
    // An organisation no one belongs to adds no one.
    expect(filter({ organisations: ['acme', 'initech'] })).toEqual(['a'])
  })

  test('combines search with the other filters', () => {
    expect(filter({ query: 'a', organisations: [NO_ORGANISATION] })).toEqual(['b'])
    expect(filter({ query: 'globex', showHidden: true })).toEqual(['c'])
  })
})

describe('sortDirectory', () => {
  test('recent: most recent appearance first, and someone never seen by when they were created', () => {
    expect(sortDirectory(everyone, 'recent').map((entry) => entry.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  test('name: A–Z ignoring case', () => {
    expect(sortDirectory(everyone, 'name').map((entry) => entry.name)).toEqual(['Alex Morgan', 'blair', 'Casey', 'Drew'])
  })

  test('ties go by name, then id', () => {
    const at = '2026-09-01T00:00:00Z'
    const tied = [
      person({ id: '2', name: 'Sam', last_seen_at: at }),
      person({ id: '1', name: 'Sam', last_seen_at: at }),
      person({ id: '3', name: 'Ada', last_seen_at: at }),
    ]
    expect(sortDirectory(tied, 'recent').map((entry) => entry.id)).toEqual(['3', '1', '2'])
    expect(sortDirectory(tied, 'name').map((entry) => entry.id)).toEqual(['3', '1', '2'])
  })

  test('does not reorder the input', () => {
    const input = [...everyone]
    sortDirectory(input, 'name')
    expect(input).toEqual(everyone)
  })
})

describe('namesakes (Create another)', () => {
  test('matches the whole name, trimmed and ignoring case', () => {
    expect(namesakesOf(everyone, '  BLAIR ').map((entry) => entry.id)).toEqual(['b'])
    expect(namesakesOf(everyone, 'Alex')).toEqual([])
  })

  test('a hidden namesake still counts', () => {
    expect(namesakesOf(everyone, 'casey').map((entry) => entry.id)).toEqual(['c'])
  })

  test('a blank name has none', () => {
    expect(namesakesOf([person({ id: 'x', name: ' ' })], '  ')).toEqual([])
  })
})

describe('organisation type-ahead', () => {
  const organisations = [{ id: 'acme', name: 'ACME' }, { id: 'globex', name: 'Globex Corp' }]

  test('matches substrings ignoring case, and lists every organisation for a blank query', () => {
    expect(matchByName(organisations, 'corp').map((entry) => entry.id)).toEqual(['globex'])
    expect(matchByName(organisations, ' ').map((entry) => entry.id)).toEqual(['acme', 'globex'])
  })

  test('an exact name ignoring case is reused, not created again', () => {
    expect(exactByName(organisations, ' acme ')?.id).toBe('acme')
    expect(exactByName(organisations, 'acm')).toBeUndefined()
    expect(exactByName(organisations, '')).toBeUndefined()
  })
})

describe('describeMergeVoice', () => {
  test('a voice with its own label keeps it', () => {
    expect(describeMergeVoice({ custom_label: 'Sam (typo)', detected_ordinals: [2] })).toBe('Sam (typo)')
  })

  // A linked speaker's own ordinal names no voice Deepgram heard.
  test('an unlabelled voice is described by the detected speakers its segments came from', () => {
    expect(describeMergeVoice({ custom_label: null, detected_ordinals: [1, 3] })).toBe('From Speaker 1, Speaker 3')
    expect(describeMergeVoice({ custom_label: null, detected_ordinals: [2, null] }))
      .toBe('From Speaker 2, Unknown speaker')
  })
})

describe('speaking time', () => {
  test('the share is a whole percentage of everyone\'s speaking time, or nothing when none is known', () => {
    expect(talkShare(150_000, 600_000)).toBe(25)
    expect(talkShare(1_000, 300_000)).toBe(0)
    expect(talkShare(600_000, 600_000)).toBe(100)
    // Never above everyone's total, however the lengths were measured.
    expect(talkShare(700_000, 600_000)).toBe(100)
    expect(talkShare(0, 0)).toBeNull()
  })

  test('the summary totals transcripts and speaking time, with the newest appearance', () => {
    expect(appearanceTotals([
      { created_at: '2026-09-10T00:00:00Z', talk_ms: 60_000 },
      { created_at: '2026-09-20T00:00:00Z', talk_ms: 30_000 },
    ])).toEqual({ transcripts: 2, talkMs: 90_000, lastSeen: '2026-09-20T00:00:00Z' })
    expect(appearanceTotals([])).toEqual({ transcripts: 0, talkMs: 0, lastSeen: null })
  })
})
