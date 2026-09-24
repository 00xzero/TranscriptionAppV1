/**
 * Text length limits, in characters. Change a number here and every input,
 * character counter, validation message and API check picks it up.
 *
 * Users may type past a limit; the counter flags the overflow and saving is
 * blocked until the value fits. Limits apply only when a value is written, never
 * to rows loaded from the database, so lowering a limit never hides existing
 * data — it only stops new values going over it.
 *
 * projectName is also enforced by the database (projects_name_length, 80), so
 * it cannot be raised above 80 without a migration. The other two are app-only.
 */
export const TEXT_LIMITS = {
  projectName: 80,
  transcriptTitle: 120,
  speakerName: 50,
} as const

/**
 * Share of a limit that must be used before the character counter appears
 * (0.75 = the last 25%). Below it the counter stays hidden; screen readers still
 * hear the limit when the field is focused.
 */
export const CHARACTER_COUNT_THRESHOLD = 0.75
