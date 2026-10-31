/**
 * The account the browser's session belongs to, in a cookie every tab can
 * read: our own user id after a sign-in, `none` after a sign-out. It is
 * written in the same response as the session cookie, so it always names the
 * session's owner, and an open page compares it with the account it loaded
 * with, without asking the server.
 *
 * Only a signal that the account changed: who someone is still comes from
 * WorkOS, and a forged value can only freeze its own page.
 */
export const ACCOUNT_MARKER_COOKIE = 'olivetti-account'
export const SIGNED_OUT_MARKER = 'none'

/**
 * What the cookie says: a user id, `none`, or null when there is no cookie
 * (a session from before the cookie existed).
 */
export function readAccountMarker(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === ACCOUNT_MARKER_COOKIE) return decodeURIComponent(value.join('=')) || null
  }
  return null
}
