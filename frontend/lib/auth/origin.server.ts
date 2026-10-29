import 'server-only'

// The browser-facing origin and the WorkOS redirect URI. A container's request
// URL may not carry the origin the browser used, so redirects build on the
// configured redirect URI when there is one.
export const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? process.env.WORKOS_REDIRECT_URI

export function appOrigin(request?: Request): string {
  if (redirectUri) return new URL(redirectUri).origin
  if (request) return new URL(request.url).origin
  throw new Error('NEXT_PUBLIC_WORKOS_REDIRECT_URI is not set')
}

/** Whether cookies must be Secure: the redirect URI is https. */
export function secureCookies(): boolean {
  return redirectUri ? new URL(redirectUri).protocol === 'https:' : true
}

/** `/auth` with the given query, on the app's origin. */
export function authUrl(params: Record<string, string | undefined>, request?: Request): URL {
  const url = new URL('/auth', appOrigin(request))
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && !(key === 'next' && value === '/')) url.searchParams.set(key, value)
  }
  return url
}

/** `/auth/finish`, which checks the session cookie stuck before going on to `to`. */
export function finishUrl(to: string, request?: Request): string {
  const url = new URL('/auth/finish', appOrigin(request))
  url.searchParams.set('to', to)
  return url.toString()
}
