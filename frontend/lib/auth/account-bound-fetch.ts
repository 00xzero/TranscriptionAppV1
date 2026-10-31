import { getAccessToken, notifyAccountChanged } from '@/infra/workos/access-token'
import { ACCOUNT_CHANGED_CODE, AccountChangedError, EXPECTED_USER_HEADER } from './account-boundary'

/**
 * A read from our own API, refused once the page has stopped because its
 * account changed in another tab, as its Supabase requests are. The route
 * itself still authenticates by the session cookie.
 */
export async function pageAccountFetch(...request: Parameters<typeof fetch>): Promise<Response> {
  await getAccessToken()
  return fetch(...request)
}

/** Cookie-authenticated mutations stay bound to the account that began the operation. */
export async function accountBoundFetch(
  path: string,
  init: RequestInit,
  expectedUserId: string,
  onDispatch?: () => void
): Promise<Response> {
  if (!expectedUserId) throw new AccountChangedError()
  init.signal?.throwIfAborted()
  await getAccessToken(expectedUserId)
  init.signal?.throwIfAborted()

  const headers = new Headers(init.headers)
  headers.set(EXPECTED_USER_HEADER, expectedUserId)
  onDispatch?.()
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      // Domain clients retain their own malformed-response handling.
      return response
    }
    if (body && typeof body === 'object' && 'code' in body && body.code === ACCOUNT_CHANGED_CODE) {
      notifyAccountChanged()
      throw new AccountChangedError()
    }
  }
  return response
}
