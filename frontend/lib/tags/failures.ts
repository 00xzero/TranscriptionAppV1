import { ZodError } from 'zod'
import { OutcomeUnknown } from '@/lib/editor/untilAnswered'
import { errorCode, isUncertainOutcome } from '@/lib/people/errors'

/**
 * Why a tag write failed, which decides what happens to its pending edit.
 *
 * - `refused`: the database answered with a code (SP001, SP002, SP003, 23505,
 *   or 42501 when signed out). Nothing was written.
 * - `unknown`: the request or its answer was lost, so the write may have
 *   happened: the editor's OutcomeUnknown, a failed fetch, or an answer that
 *   failed its parse after the database had acted.
 * - `local`: the app stopped before sending (an account change, an argument
 *   refused locally without a code), so nothing was sent; or the editor's
 *   sender closed, which the tags store settles on the request's own answer.
 */
export type TagWriteFailure = 'refused' | 'unknown' | 'local'

export function tagWriteFailure(error: unknown): TagWriteFailure {
  if (error instanceof OutcomeUnknown || error instanceof ZodError || isUncertainOutcome(error)) return 'unknown'
  return errorCode(error) ? 'refused' : 'local'
}
