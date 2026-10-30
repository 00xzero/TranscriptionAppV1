import 'server-only'

import { ACCOUNT_CHANGED_CODE, ACCOUNT_CHANGED_MESSAGE, EXPECTED_USER_HEADER } from './account-boundary'

/** Check the operation's owner against authentication before starting domain work. */
export function getAccountChangeError(
  request: Request,
  authenticatedUserId: string
): { error: string; code: typeof ACCOUNT_CHANGED_CODE } | null {
  if (request.headers.get(EXPECTED_USER_HEADER) === authenticatedUserId) return null
  return { error: ACCOUNT_CHANGED_MESSAGE, code: ACCOUNT_CHANGED_CODE }
}
