import { TEXT_LIMITS } from '@/contracts/limits'

/** Shown when a guarded write was refused and the page reloaded (spec §7). */
export const CONFLICT_TOAST = 'Changed in another tab — refreshed'
export const STALE_TOAST = "Changed in another tab — couldn't refresh"
export const NOT_READY_MESSAGE = 'Speaker changes are available when transcription is complete.'
/** Said with CONFLICT_TOAST when a reload drops text typed against a segment's old shape. */
export const DROPPED_DRAFT_MESSAGE = "Your last edit to a segment that changed wasn't saved."

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

/** A guarded write refused because what it expected has changed since (SP002). */
export function isConflict(error: unknown): boolean {
  return errorCode(error) === 'SP002'
}

/** What the write acted on is gone, e.g. the person was merged away in another tab (SP001). */
export function isGone(error: unknown): boolean {
  return errorCode(error) === 'SP001'
}

export function isNotReady(error: unknown): boolean {
  return errorCode(error) === 'SP004'
}

/**
 * A segment text save matched no row: the segment was split or rejoined since
 * the text was edited (its revision moved on), or it is gone.
 */
export function isStaleSegmentSave(error: unknown): boolean {
  return errorCode(error) === 'PGRST116'
}

/**
 * No answer came back from the database (a network failure or a lost
 * response), so the write may or may not have happened. postgrest-js reports
 * these with an empty code; a database refusal always carries one.
 */
export function isUncertainOutcome(error: unknown): boolean {
  return !errorCode(error)
}

/** A user-facing message for a failed directory write. */
export function mapPeopleWriteError(error: unknown, subject: 'person' | 'organisation' = 'person'): string {
  switch (errorCode(error)) {
    case 'SP001':
      return subject === 'organisation' ? 'That organisation no longer exists.' : 'That person no longer exists.'
    case 'SP002':
      return 'Changed in another tab. Please try again.'
    case 'SP004':
      return NOT_READY_MESSAGE
    case 'SP003':
      return subject === 'organisation'
        ? `Organisation names must be 1 to ${TEXT_LIMITS.organisationName} characters.`
        : `Names must be 1 to ${TEXT_LIMITS.speakerName} characters.`
    case '23505':
      return 'Another organisation already has that name.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
