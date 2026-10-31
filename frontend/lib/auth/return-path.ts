// A path to send someone after sign-in, kept to this app and never an auth
// route.
export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  const base = 'https://app.invalid'
  const url = new URL(path, base)
  if (url.origin !== base) return '/'
  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return '/'
  return `${url.pathname}${url.search}`
}
