import { TEXT_LIMITS } from '@/contracts/limits'

/** Shown when a guarded write was refused and the page reloaded (spec §7). */
export const CONFLICT_TOAST = 'Changed in another tab — refreshed'

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

/** A user-facing message for a failed directory write. */
export function mapPeopleWriteError(error: unknown, subject: 'person' | 'organisation' = 'person'): string {
  switch (errorCode(error)) {
    case 'SP001':
      return subject === 'organisation' ? 'That organisation no longer exists.' : 'That person no longer exists.'
    case 'SP002':
      return CONFLICT_TOAST
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
