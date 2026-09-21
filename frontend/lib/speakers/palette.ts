// Single source of truth for speaker avatar colors and initials. Shared by the
// editor's auto-assignment (useSpeakerAssignments), the speaker picker
// (SpeakerPopoverContent), and the project surfaces (SpeakerAvatarGroup) — keep
// them on the same list so a color assigned in one place is one the others offer.
// Ordered per the Olivetti prototype: trust-blue, ember-red, yellow-600,
// then brand-complementary hues.
export const SPEAKER_COLORS = [
  '#4F638C', '#C73E1D', '#CA8A04',
  '#0D9488', '#7C3AED', '#64748B',
  '#B45309', '#059669', '#DB2777', '#2563EB',
] as const

// Neutral shown when no speaker is tagged.
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
 * Stored color wins; otherwise the palette position. Pass `paletteIndex` null
 * when the caller has no position for the speaker (unknown or untagged).
 *
 * The bare truthiness check on `color` is deliberate: a whitespace-only color
 * has always been treated as a stored value here, and trimming would silently
 * repaint those speakers grey.
 */
export function resolveSpeakerColor(
  speaker: { color?: string | null } | null | undefined,
  paletteIndex: number | null | undefined
): string {
  if (!speaker) return SPEAKER_COLOR_FALLBACK
  if (speaker.color) return speaker.color
  if (paletteIndex == null) return SPEAKER_COLOR_FALLBACK
  return speakerPaletteColor(paletteIndex)
}

/**
 * Color per speaker id for an ordered speaker list — the editor's shape.
 *
 * Array position IS the palette index, so the list must already be sorted by
 * (created_at, id) to agree with project_speaker_summaries. fetchSpeakers()
 * orders on exactly those two columns.
 */
export function buildSpeakerColorMap(
  speakers: readonly { id: string; color: string | null }[]
): Map<string, string> {
  const map = new Map<string, string>()
  speakers.forEach((speaker, index) => map.set(speaker.id, resolveSpeakerColor(speaker, index)))
  return map
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
