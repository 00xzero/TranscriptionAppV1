import type { Speaker } from '@/contracts/db'

/**
 * The one speaker label resolver (spec §3 rules 4–5). The editor, every export
 * and the project summaries take their speaker labels from here; nothing else
 * builds one.
 */

/** Shown for a segment with no speaker. Unknown is not a speaker. */
export const UNKNOWN_SPEAKER_LABEL = 'Unknown speaker'

/** Identity key of an unassigned segment. */
export const UNKNOWN_IDENTITY_KEY = 'unknown'

export type LabelledSpeaker = Pick<Speaker, 'id' | 'ordinal' | 'custom_label'> & {
  person_id?: string | null
}

export type LabelledPerson = {
  id: string
  name: string
  organisation_name?: string | null
}

/** Resolved display label per transcript speaker id. */
export type SpeakerLabels = ReadonlyMap<string, string>

/** One displayed identity: a linked person, or an unlinked transcript speaker. */
export type SpeakerIdentity = {
  key: string
  personId: string | null
  /** As shown on a turn: `Paul`, `Paul (ACME)`, `Paul (2)`. */
  label: string
  /** As listed once in an export's Participants block: `Paul — ACME`. */
  participant: string
}

export type SpeakerPresentation = {
  labels: SpeakerLabels
  /** Displayed identity per transcript speaker id; turns follow it. */
  identityKeys: ReadonlyMap<string, string>
  /** Identities referenced by segments, in order of first appearance. */
  identities: readonly SpeakerIdentity[]
  /** Transcript speakers referenced by segments, in order of first appearance. */
  usedSpeakerIds: readonly string[]
  /** People first, then unlinked voices; Unknown is not listed. */
  participants: readonly string[]
}

export function genericSpeakerLabel(ordinal: number): string {
  return `Speaker ${ordinal}`
}

/** A speaker's own label, before telling it apart from others in its transcript. */
export function speakerBaseLabel(ordinal: number, customLabel: string | null): string {
  return customLabel ?? genericSpeakerLabel(ordinal)
}

/**
 * Labels and identities for one transcript's speakers.
 *
 * A linked speaker shows its person's name; two voices linked to one person are
 * one identity. Identities with segments whose labels collide take their
 * organisation (`Paul (ACME)`), then a number (`Paul (2)`). "First" is first
 * appearance in `segments`, which must be in transcript order; speakers with no
 * segments follow by ordinal and never change another identity's label. Equality is exact, so `Paul` and `paul` stay as they are.
 * A person missing from `people` leaves the speaker unlinked here.
 */
export function resolveSpeakerPresentation(
  speakers: readonly LabelledSpeaker[],
  segments: readonly { speaker_id: string | null }[],
  people: readonly LabelledPerson[] = []
): SpeakerPresentation {
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]))
  const personById = new Map(people.map((person) => [person.id, person]))
  const personOf = (speaker: LabelledSpeaker) =>
    speaker.person_id ? personById.get(speaker.person_id) : undefined
  const keyOf = (speaker: LabelledSpeaker) => {
    const person = personOf(speaker)
    return person ? `person:${person.id}` : `speaker:${speaker.id}`
  }

  const usedSpeakerIds: string[] = []
  const used = new Set<string>()
  for (const segment of segments) {
    const id = segment.speaker_id
    if (!id || used.has(id) || !speakerById.has(id)) continue
    used.add(id)
    usedSpeakerIds.push(id)
  }
  const ordered = [
    ...usedSpeakerIds.map((id) => speakerById.get(id)!),
    ...speakers
      .filter((speaker) => !used.has(speaker.id))
      .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id)),
  ]

  type Draft = { key: string; personId: string | null; name: string; organisation: string | null }
  const drafts = new Map<string, Draft>()
  for (const speaker of ordered) {
    const key = keyOf(speaker)
    if (drafts.has(key)) continue
    const person = personOf(speaker)
    drafts.set(key, {
      key,
      personId: person?.id ?? null,
      name: person?.name ?? speakerBaseLabel(speaker.ordinal, speaker.custom_label),
      organisation: person?.organisation_name ?? null,
    })
  }

  // Only identities with segments can clash, so a speaker left with none never
  // changes what a visible one is called. Drafts list those identities first.
  const usedKeys = new Set(usedSpeakerIds.map((id) => keyOf(speakerById.get(id)!)))
  const shown = [...drafts.values()].filter((draft) => usedKeys.has(draft.key))
  const nameCounts = new Map<string, number>()
  for (const draft of shown) nameCounts.set(draft.name, (nameCounts.get(draft.name) ?? 0) + 1)
  const withOrganisation = (draft: Draft) =>
    (nameCounts.get(draft.name) ?? 0) > 1 && draft.organisation ? `${draft.name} (${draft.organisation})` : draft.name
  // A number another identity already shows as its own label is skipped.
  const reserved = new Set(shown.map(withOrganisation))
  const taken = new Set<string>()
  const nextNumber = new Map<string, number>()
  const identityByKey = new Map<string, SpeakerIdentity>()
  for (const draft of drafts.values()) {
    const base = withOrganisation(draft)
    let label = base
    let suffix = ''
    if (taken.has(base)) {
      let n = nextNumber.get(base) ?? 2
      while (taken.has(`${base} (${n})`) || reserved.has(`${base} (${n})`)) n++
      nextNumber.set(base, n + 1)
      suffix = ` (${n})`
      label = `${base}${suffix}`
    }
    taken.add(label)
    identityByKey.set(draft.key, {
      key: draft.key,
      personId: draft.personId,
      label,
      participant: draft.organisation ? `${draft.name}${suffix} — ${draft.organisation}` : label,
    })
  }

  const labels = new Map<string, string>()
  const identityKeys = new Map<string, string>()
  for (const speaker of ordered) {
    const key = keyOf(speaker)
    identityKeys.set(speaker.id, key)
    labels.set(speaker.id, identityByKey.get(key)!.label)
  }

  const identities = [...new Set(usedSpeakerIds.map((id) => identityKeys.get(id)!))]
    .map((key) => identityByKey.get(key)!)
  const participants = [
    ...identities.filter((identity) => identity.personId),
    ...identities.filter((identity) => !identity.personId),
  ].map((identity) => identity.participant)

  return { labels, identityKeys, identities, usedSpeakerIds, participants }
}

export function resolveSpeakerLabels(
  speakers: readonly LabelledSpeaker[],
  segments: readonly { speaker_id: string | null }[],
  people: readonly LabelledPerson[] = []
): SpeakerLabels {
  return resolveSpeakerPresentation(speakers, segments, people).labels
}

/**
 * The displayed identity of a segment's speaker id. A speaker missing from the
 * presentation (not loaded yet) stays its own identity rather than merging
 * with Unknown or with other missing speakers.
 */
export function displayedIdentityKey(
  presentation: Pick<SpeakerPresentation, 'identityKeys'>,
  speakerId: string | null | undefined
): string {
  if (!speakerId) return UNKNOWN_IDENTITY_KEY
  return presentation.identityKeys.get(speakerId) ?? `speaker:${speakerId}`
}

/** The label for a segment's speaker id: Unknown when there is none. */
export function speakerLabelFor(labels: SpeakerLabels, speakerId: string | null | undefined): string {
  return (speakerId ? labels.get(speakerId) : undefined) ?? UNKNOWN_SPEAKER_LABEL
}
