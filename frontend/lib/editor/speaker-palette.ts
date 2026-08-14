// Single source of truth for speaker avatar colors. Used by the editor's
// auto-assignment (useSpeakerAssignments) and the speaker picker
// (SpeakerPopoverContent) — keep them on the same list so an auto-assigned
// color is always one the picker offers.
// Ordered per the Olivetti prototype: trust-blue, ember-red, yellow-600,
// then brand-complementary hues.
export const SPEAKER_COLORS = [
  '#4F638C', '#C73E1D', '#CA8A04',
  '#0D9488', '#7C3AED', '#64748B',
  '#B45309', '#059669', '#DB2777', '#2563EB',
] as const

// Neutral shown when no speaker is tagged.
export const SPEAKER_COLOR_FALLBACK = '#9CA3AF'
