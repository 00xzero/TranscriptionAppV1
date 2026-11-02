import { TEXT_LIMITS } from '@/contracts/limits'

/** Shown when a guarded write was refused and the page reloaded (spec §7). */
export const CONFLICT_TOAST = 'Changed in another tab — refreshed'
export const STALE_TOAST = "Changed in another tab — couldn't refresh"
export const NOT_READY_MESSAGE = 'Speaker changes are available when transcription is complete.'
/** Said with CONFLICT_TOAST when a reload drops text typed against a segment's old shape. */
export const DROPPED_DRAFT_MESSAGE = "Your last edit to a segment that changed wasn't saved."

export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

/** A guarded write refused because what it expected has changed since (SP002). */
export function isConflict(error: unknown): boolean {
  return errorCode(error) === 'SP002'
}

/** Refuses, as the database would (SP002), a write a local check found built on something changed since. */
export const changedSince = (message: string) => ({ code: 'SP002', message })

/** What the write acted on is gone, e.g. the person was merged away in another tab (SP001). */
export function isGone(error: unknown): boolean {
  return errorCode(error) === 'SP001'
}

export function isNotReady(error: unknown): boolean {
  return errorCode(error) === 'SP004'
}

/**
 * No answer came back from the database (a network failure or a lost
 * response), so the write may or may not have happened. postgrest-js reports
 * a failed fetch with an empty code, and a body it can't read as JSON (a
 * gateway's 502 page) as a plain `{ message }` with no code at all. A
 * database refusal always carries a code. An Error with no code was thrown
 * by the app itself, before or after the request.
 */
export function isUncertainOutcome(error: unknown): boolean {
  if (errorCode(error) === '') return true
  return !!error && typeof error === 'object' && !(error instanceof Error) && !('code' in error) && 'message' in error
}

export type WriteSubject = 'person' | 'organisation' | 'tag'

const NAMED: Record<WriteSubject, { gone: string; invalid: string; taken: string }> = {
  person: {
    gone: 'That person no longer exists.',
    invalid: `Names must be 1 to ${TEXT_LIMITS.speakerName} characters.`,
    taken: 'Another organisation already has that name.',
  },
  organisation: {
    gone: 'That organisation no longer exists.',
    invalid: `Organisation names must be 1 to ${TEXT_LIMITS.organisationName} characters.`,
    taken: 'Another organisation already has that name.',
  },
  tag: {
    gone: 'That tag no longer exists.',
    invalid: `Tag names must be 1 to ${TEXT_LIMITS.tagName} characters.`,
    taken: 'Another tag already has that name.',
  },
}

/** A user-facing message for a failed directory or tag write. */
export function mapPeopleWriteError(error: unknown, subject: WriteSubject = 'person'): string {
  switch (errorCode(error)) {
    case 'SP001':
      return NAMED[subject].gone
    case 'SP002':
      return 'Changed in another tab. Please try again.'
    case 'SP004':
      return NOT_READY_MESSAGE
    case 'SP003':
      return NAMED[subject].invalid
    case '23505':
      return NAMED[subject].taken
    default:
      return 'Something went wrong. Please try again.'
  }
}
