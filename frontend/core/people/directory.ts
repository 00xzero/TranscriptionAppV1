import type { MergePreviewVoice } from '@/contracts/db'
import { genericSpeakerLabel, UNKNOWN_SPEAKER_LABEL } from '@/core/speakers/labels'

/**
 * The People directory's list rules (spec §4): search, the organisation
 * filter, hidden people and the two orders. Pure, so the list page and its
 * tests share one definition.
 */

/** Organisation filter values besides an organisation id. */
export const ALL_ORGANISATIONS = 'all'
export const NO_ORGANISATION = 'none'

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
 * The people the list shows. `organisation` is ALL_ORGANISATIONS,
 * NO_ORGANISATION or an organisation id. Hidden people are left out unless
 * `showHidden` is on.
 */
export function filterDirectory<T extends ListedPerson>(
  people: readonly T[],
  { query, organisation, showHidden }: { query: string; organisation: string; showHidden: boolean }
): T[] {
  return people.filter((person) =>
    (showHidden || !person.hidden) &&
    (organisation === ALL_ORGANISATIONS ||
      (organisation === NO_ORGANISATION ? person.organisation_id === null : person.organisation_id === organisation)) &&
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
