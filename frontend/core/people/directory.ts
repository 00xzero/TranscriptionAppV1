import type { MergePreview, MergePreviewVoice, Organisation, PeopleDirectory, Person } from '@/contracts/db'
import { genericSpeakerLabel, UNKNOWN_SPEAKER_LABEL } from '@/core/speakers/labels'

/**
 * The People directory's list rules (spec §4): search, the organisation
 * filter, hidden people and the two orders. Pure, so the list page and its
 * tests share one definition.
 */

/** The organisation filter's value for people with no organisation, beside organisation ids. */
export const NO_ORGANISATION = 'none'

/** Keep a confirmed write visible even if the following directory read fails. */
export function updateDirectoryPerson(data: PeopleDirectory, person: Person, organisation?: Organisation | null): PeopleDirectory {
  const previous = data.people.find((entry) => entry.id === person.id)
  const organisations = organisation
    ? data.organisations.some((entry) => entry.id === organisation.id)
      ? data.organisations.map((entry) => entry.id === organisation.id ? { ...entry, ...organisation } : entry)
      : [...data.organisations, { ...organisation, person_count: 0 }]
    : data.organisations
  const updated = {
    ...previous, ...person,
    organisation_name: organisation?.name ?? organisations.find((entry) => entry.id === person.organisation_id)?.name ?? null,
    transcript_count: previous?.transcript_count ?? 0,
    last_seen_at: previous?.last_seen_at ?? null,
  }
  const people = (previous ? data.people.map((entry) => entry.id === person.id ? updated : entry) : [...data.people, updated])
    .map((entry) => organisation && entry.organisation_id === organisation.id
      ? { ...entry, organisation_name: organisation.name } : entry)
  return { people, organisations: organisations.map((entry) => ({
    ...entry, person_count: people.filter((person) => person.organisation_id === entry.id).length,
  })) }
}

/** Apply a confirmed merge before reloading; the guarded preview supplies its appearance union. */
export function mergeDirectoryPeople(data: PeopleDirectory, survivor: Person, preview: MergePreview): PeopleDirectory {
  const mergedIds = new Set(preview.people.map((person) => person.person_id))
  const updated = updateDirectoryPerson({ ...data, people: data.people.filter((person) => !mergedIds.has(person.id)) }, survivor)
  const moving = preview.people.flatMap((person) => person.transcripts)
  const transcriptIds = new Set([...preview.survivor_transcript_ids, ...moving.map((row) => row.transcript_id)])
  const previous = data.people.find((person) => person.id === survivor.id)
  const lastSeen = moving.reduce<string | null>((latest, row) =>
    latest === null || Date.parse(row.created_at) > Date.parse(latest) ? row.created_at : latest,
    preview.survivor_transcript_ids.length > 0 ? previous?.last_seen_at ?? null : null)
  const organisationName = [preview.survivor, ...preview.people]
    .find((person) => person.organisation_id === survivor.organisation_id)?.organisation_name ?? null
  return { ...updated, people: updated.people.map((person) => person.id === survivor.id ? {
    ...person, organisation_name: organisationName, transcript_count: transcriptIds.size, last_seen_at: lastSeen,
  } : person) }
}

export type DirectoryOrder = 'recent' | 'name'

type ListedPerson = {
  id: string
  name: string
  organisation_id: string | null
  organisation_name: string | null
  hidden: boolean
  created_at: string
  last_seen_at: string | null
}

/** Names equal once trimmed and compared without case: what "Create another" means. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** People already called `name`, for the "Create another" wording. None for a blank name. */
export function namesakesOf<T extends { name: string }>(people: readonly T[], name: string): T[] {
  if (!name.trim()) return []
  return people.filter((person) => sameName(person.name, name))
}

/** Case-insensitive substring of the name or the organisation; outer whitespace is ignored. */
export function matchesPersonSearch(
  person: Pick<ListedPerson, 'name' | 'organisation_name'>,
  query: string
): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return person.name.toLocaleLowerCase().includes(needle) ||
    (person.organisation_name?.toLocaleLowerCase().includes(needle) ?? false)
}

/**
 * The people the list shows. `organisations` holds the selected organisation
 * ids and NO_ORGANISATION; a person in any of them is shown, and with none
 * selected everyone is. Hidden people are left out unless `showHidden` is on.
 */
export function filterDirectory<T extends ListedPerson>(
  people: readonly T[],
  { query, organisations, showHidden }: { query: string; organisations: readonly string[]; showHidden: boolean }
): T[] {
  const selected = new Set(organisations)
  return people.filter((person) =>
    (showHidden || !person.hidden) &&
    (selected.size === 0 || selected.has(person.organisation_id ?? NO_ORGANISATION)) &&
    matchesPersonSearch(person, query))
}

const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/**
 * 'recent': most recent appearance first; a person with none is placed by when
 * they were created, on the same timeline. 'name': A–Z. Ties go by name, then id.
 */
export function sortDirectory<T extends ListedPerson>(people: readonly T[], order: DirectoryOrder): T[] {
  const byName = (a: T, b: T) => compareNames(a.name, b.name) || a.id.localeCompare(b.id)
  if (order === 'name') return [...people].sort(byName)
  const seen = (person: T) => Date.parse(person.last_seen_at ?? person.created_at)
  return [...people].sort((a, b) => seen(b) - seen(a) || byName(a, b))
}

/**
 * A person's share of the speaking in one transcript, as a whole percentage;
 * null when nobody's speaking time is known.
 */
export function talkShare(talkMs: number, totalMs: number): number | null {
  if (totalMs <= 0) return null
  return Math.round((100 * Math.min(talkMs, totalMs)) / totalMs)
}

export type AppearanceTotals = { transcripts: number; talkMs: number; lastSeen: string | null }

/** The person page's summary, from their appearances. */
export function appearanceTotals(rows: readonly { created_at: string; talk_ms: number }[]): AppearanceTotals {
  let lastSeen: string | null = null
  for (const row of rows) {
    if (lastSeen === null || Date.parse(row.created_at) > Date.parse(lastSeen)) lastSeen = row.created_at
  }
  return { transcripts: rows.length, talkMs: rows.reduce((sum, row) => sum + row.talk_ms, 0), lastSeen }
}

/** Organisations whose name contains the query, for the type-ahead; all of them for a blank query. */
export function matchOrganisations<T extends { name: string }>(organisations: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...organisations]
  return organisations.filter((organisation) => organisation.name.toLocaleLowerCase().includes(needle))
}

/** The organisation already called `name`, ignoring case, which the database would reuse. */
export function exactOrganisation<T extends { name: string }>(organisations: readonly T[], name: string): T | undefined {
  if (!name.trim()) return undefined
  return organisations.find((organisation) => sameName(organisation.name, name))
}

/**
 * How a merge preview names a local voice: its own label, or the detected
 * speakers its segments came from, since a linked speaker's own ordinal names
 * no voice Deepgram heard.
 */
export function describeMergeVoice(voice: Pick<MergePreviewVoice, 'custom_label' | 'detected_ordinals'>): string {
  if (voice.custom_label) return voice.custom_label
  const sources = voice.detected_ordinals.map((ordinal) =>
    ordinal === null ? UNKNOWN_SPEAKER_LABEL : genericSpeakerLabel(ordinal))
  return sources.length > 0 ? `From ${sources.join(', ')}` : UNKNOWN_SPEAKER_LABEL
}
