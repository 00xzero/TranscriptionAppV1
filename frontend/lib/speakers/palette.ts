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

export type SpeakerColor = (typeof SPEAKER_COLORS)[number]

/** What the colour picker calls each palette colour, for people who cannot see it. */
export const SPEAKER_COLOR_NAMES: Readonly<Record<SpeakerColor, string>> = {
  '#4F638C': 'Denim', '#C73E1D': 'Red', '#CA8A04': 'Mustard',
  '#0D9488': 'Teal', '#7C3AED': 'Violet', '#64748B': 'Slate',
  '#B45309': 'Bronze', '#059669': 'Green', '#DB2777': 'Pink', '#2563EB': 'Blue',
}

// Neutral: unlinked voices and Unknown.
export const SPEAKER_COLOR_FALLBACK = '#9CA3AF'

/**
 * Each palette colour as a soft chip (tags): a tinted background with the
 * colour as text, for the light and the dark theme. Every pair reads at 5:1
 * or better; a test checks it never drops below 4.5:1.
 */
export const SPEAKER_COLOR_TINTS: Readonly<Record<SpeakerColor, {
  light: { bg: string; fg: string }
  dark: { bg: string; fg: string }
}>> = {
  '#4F638C': { light: { bg: '#E3E6ED', fg: '#4D6087' }, dark: { bg: '#2E353F', fg: '#A7AFC0' } },
  '#C73E1D': { light: { bg: '#F6E0DB', fg: '#A8381C' }, dark: { bg: '#57291A', fg: '#DFA191' } },
  '#CA8A04': { light: { bg: '#F7ECD7', fg: '#815D0C' }, dark: { bg: '#584311', fg: '#E0C386' } },
  '#0D9488': { light: { bg: '#D8EEEC', fg: '#126E64' }, dark: { bg: '#18463E', fg: '#8DC7C1' } },
  '#7C3AED': { light: { bg: '#EADFFC', fg: '#7337D8' }, dark: { bg: '#3D2860', fg: '#BE9FED' } },
  '#64748B': { light: { bg: '#E6E9EC', fg: '#566374' }, dark: { bg: '#353B3F', fg: '#B1B6C0' } },
  '#B45309': { light: { bg: '#F3E3D8', fg: '#99490C' }, dark: { bg: '#503013', fg: '#D7AA89' } },
  '#059669': { light: { bg: '#D7EEE7', fg: '#0D704F' }, dark: { bg: '#154734', fg: '#8AC8B3' } },
  '#DB2777': { light: { bg: '#F9DCE9', fg: '#AD2560' }, dark: { bg: '#5E2138', fg: '#E89BBB' } },
  '#2563EB': { light: { bg: '#DCE6FC', fg: '#2458C9' }, dark: { bg: '#203560', fg: '#94AFEC' } },
}

/**
 * The colour something new gets (a person, a tag): the one least used among
 * the colours already taken, earliest in the palette on a tie. Mirrors
 * editor_create_person, so a person shown before the database confirms it
 * already has its final colour.
 */
export function leastUsedSpeakerColor(taken: readonly string[]): string {
  const uses = new Map<string, number>()
  for (const color of taken) uses.set(color, (uses.get(color) ?? 0) + 1)
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
