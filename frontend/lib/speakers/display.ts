import type { Speaker } from '@/contracts/db'
import {
  displayedIdentityKey,
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
