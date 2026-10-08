import type { ProjectSpeakerPreview, Speaker } from '@/contracts/db'
import {
  displayedIdentityKey,
  resolveSpeakerLabels,
  speakerLabelFor,
  UNKNOWN_SPEAKER_LABEL,
  type SpeakerPresentation,
} from '@/core/speakers/labels'
import { resolveTranscriptColors, SPEAKER_COLOR_FALLBACK, speakerInitials } from './palette'

/** Everything a transcript row shows for its speaker. */
export type SpeakerDisplay = {
  label: string
  /** Turns follow this; see displayedIdentityKey. */
  identityKey: string
  color: string
  avatarText: string
  /** A linked person's organisation, for the avatar tooltip. */
  organisation: string | null
}

type DisplayPerson = { id: string; name: string; organisation_name: string | null; preferred_color: string }

/**
 * A lookup from a segment's speaker id to its display (spec §8). A linked
 * speaker shows its person's initials, an unlinked one its custom label's
 * initials or `S{ordinal}`, and Unknown a neutral `?`.
 */
export function buildSpeakerDisplay(
  speakers: readonly Speaker[],
  presentation: SpeakerPresentation,
  people: readonly DisplayPerson[]
): (speakerId: string | null | undefined) => SpeakerDisplay {
  const colors = resolveTranscriptColors(presentation, people)
  const personById = new Map(people.map((person) => [person.id, person]))
  const displays = new Map<string, SpeakerDisplay>()
  for (const speaker of speakers) {
    const person = speaker.person_id ? personById.get(speaker.person_id) : undefined
    displays.set(speaker.id, {
      label: presentation.labels.get(speaker.id) ?? UNKNOWN_SPEAKER_LABEL,
      identityKey: displayedIdentityKey(presentation, speaker.id),
      color: colors.get(speaker.id) ?? SPEAKER_COLOR_FALLBACK,
      avatarText: person ? speakerInitials(person.name)
        : speaker.custom_label ? speakerInitials(speaker.custom_label) : `S${speaker.ordinal}`,
      organisation: person?.organisation_name ?? null,
    })
  }
  return (speakerId) => (speakerId ? displays.get(speakerId) : undefined) ?? {
    label: UNKNOWN_SPEAKER_LABEL,
    identityKey: displayedIdentityKey(presentation, speakerId),
    color: SPEAKER_COLOR_FALLBACK,
    avatarText: '?',
    organisation: null,
  }
}

/** Everything a project avatar shows for one preview entry. */
export type PreviewDisplay = {
  key: string
  tooltip: string
  avatarText: string
  color: string
}

/**
 * A project avatar (spec §8). A person shows their name and preferred colour,
 * with their organisation in the tooltip, as the editor's avatar does. A voice
 * is grey and labelled by the resolver among its transcript's identities, so it
 * reads exactly as it does in the editor (`Paul (2)`); its tooltip names the
 * transcript (`Speaker 1 · Q3 steering`).
 */
export function previewDisplay(entry: ProjectSpeakerPreview): PreviewDisplay {
  if (entry.kind === 'person') {
    return {
      key: `person:${entry.id}`,
      tooltip: entry.organisationName ? `${entry.name} · ${entry.organisationName}` : entry.name,
      avatarText: speakerInitials(entry.name),
      color: entry.color,
    }
  }
  const labels = resolveSpeakerLabels(
    entry.peers.map((peer) => ({ id: peer.id, ordinal: peer.ordinal, custom_label: peer.customLabel, person_id: peer.personId })),
    // Peers arrive in order of first appearance, which is all the resolver reads from segments.
    entry.peers.map((peer) => ({ speaker_id: peer.id })),
    entry.peers.flatMap((peer) => peer.personId && peer.personName !== null
      ? [{ id: peer.personId, name: peer.personName, organisation_name: peer.organisationName }]
      : [])
  )
  const label = speakerLabelFor(labels, entry.id)
  const self = entry.peers.find((peer) => peer.id === entry.id)
  return {
    key: `voice:${entry.id}`,
    tooltip: `${label} · ${entry.transcriptTitle || 'Untitled'}`,
    // As the editor draws an unlinked voice: its label's initials, or S{N}.
    avatarText: self?.customLabel ? speakerInitials(self.customLabel) : self ? `S${self.ordinal}` : '?',
    color: SPEAKER_COLOR_FALLBACK,
  }
}
