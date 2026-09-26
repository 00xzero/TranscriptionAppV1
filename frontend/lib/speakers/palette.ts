import type { SpeakerPresentation } from '@/core/speakers/labels'

// Single source of truth for speaker avatar colors and initials, shared by the
// editor and the project surfaces (SpeakerAvatarGroup). The database holds the
// same list in the same allocation order as speaker_palette() (people_editor
// migration); a Jest test keeps the two equal.
// Ordered per the Olivetti prototype: trust-blue, ember-red, yellow-600,
// then brand-complementary hues.
export const SPEAKER_COLORS = [
  '#4F638C', '#C73E1D', '#CA8A04',
  '#0D9488', '#7C3AED', '#64748B',
  '#B45309', '#059669', '#DB2777', '#2563EB',
] as const

// Neutral: unlinked voices and Unknown.
export const SPEAKER_COLOR_FALLBACK = '#9CA3AF'

/**
 * Palette color for a 0-based position, wrapping past the end of the list.
 * Total: a negative, non-integer or non-finite index yields the neutral
 * fallback rather than `undefined`.
 */
export function speakerPaletteColor(paletteIndex: number): string {
  if (!Number.isInteger(paletteIndex) || paletteIndex < 0) return SPEAKER_COLOR_FALLBACK
  return SPEAKER_COLORS[paletteIndex % SPEAKER_COLORS.length]
}

/**
 * The colour a new person gets: the one least used among the account's people,
 * earliest in the palette on a tie. Mirrors editor_create_person, so a person
 * shown before the database confirms it already has its final colour.
 */
export function leastUsedSpeakerColor(people: readonly { preferred_color: string }[]): string {
  const uses = new Map<string, number>()
  for (const person of people) uses.set(person.preferred_color, (uses.get(person.preferred_color) ?? 0) + 1)
  return SPEAKER_COLORS.reduce((best, color) =>
    (uses.get(color) ?? 0) < (uses.get(best) ?? 0) ? color : best)
}

/**
 * Avatar colour per transcript speaker id (spec §8). People claim their
 * preferred colour in order of first appearance; a person whose colour is
 * already taken gets the next free one. Unlinked voices are neutral.
 */
export function resolveTranscriptColors(
  presentation: Pick<SpeakerPresentation, 'identities' | 'identityKeys'>,
  people: readonly { id: string; preferred_color: string }[]
): Map<string, string> {
  const preferred = new Map(people.map((person) => [person.id, person.preferred_color]))
  const byIdentity = new Map<string, string>()
  const used = new Set<string>()
  for (const identity of presentation.identities) {
    if (!identity.personId) continue
    const wanted = preferred.get(identity.personId) ?? SPEAKER_COLORS[0]
    const color = !used.has(wanted)
      ? wanted
      : SPEAKER_COLORS.find((candidate) => !used.has(candidate)) ??
        SPEAKER_COLORS[byIdentity.size % SPEAKER_COLORS.length]
    byIdentity.set(identity.key, color)
    used.add(color)
  }
  const colors = new Map<string, string>()
  for (const [speakerId, key] of presentation.identityKeys) {
    colors.set(speakerId, byIdentity.get(key) ?? SPEAKER_COLOR_FALLBACK)
  }
  return colors
}

/**
 * Up to two initials for an avatar: 'Kate' -> 'K', 'John Smith' -> 'JS',
 * 'Speaker 1' -> 'S1', blank or whitespace-only -> '?'.
 *
 * Array.from takes a whole code point, so a label starting with an emoji or a
 * non-BMP character renders that character rather than half a surrogate pair.
 */
export function speakerInitials(label: string): string {
  const parts = (label ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0])[0] ?? ''
  const second = parts.length > 1 ? (Array.from(parts[1])[0] ?? '') : ''
  return (first + second).toUpperCase() || '?'
}
