/** An expectation checked against authentication, never a source of authority. */
export const EXPECTED_USER_HEADER = 'x-expected-user-id'
export const ACCOUNT_CHANGED_CODE = 'ACCOUNT_CHANGED'
export const ACCOUNT_CHANGED_MESSAGE =
  'Your account changed in another tab. Switch back to the original account and try again.'

export class AccountChangedError extends Error {
  constructor() {
    super(ACCOUNT_CHANGED_MESSAGE)
    this.name = 'AccountChangedError'
  }
}

export function isAccountChangedError(error: unknown): boolean {
  // Supabase and TUS can wrap a token callback's exception in their own error.
  return typeof error === 'object' && error !== null && 'message' in error &&
    typeof error.message === 'string' && error.message.includes(ACCOUNT_CHANGED_MESSAGE)
}
