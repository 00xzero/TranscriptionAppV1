/**
 * Next.js Proxy for WorkOS AuthKit.
 *
 * - Skips session processing for `/api/inngest` and `/api/webhooks/` requests;
 *   webhook routes own callback authentication and health access checks
 * - Refreshes the AuthKit session on other matched requests (so `withAuth()`
 *   works in routes and pages)
 * - Sends signed-out visitors on protected routes to our sign-in page
 *   (app/auth/page.tsx), which returns them to the page they asked for
 * - Never treats a WorkOS outage as being signed out (see `sessionUnconfirmed`)
 */
import {
  applyResponseHeaders,
  authkit,
  handleAuthkitHeaders,
  partitionAuthkitHeaders,
} from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_ROUTES = ['/transcripts', '/editor', '/recording', '/projects', '/people']

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/auth']

// Routes that should be excluded from auth redirect logic (callbacks, etc).
// Sign-out is posted by signed-in visitors, so it must not bounce to /;
// finish and the OAuth callback check the session themselves; and a reset
// link must work whoever is signed in.
const CALLBACK_ROUTES = ['/auth/callback', '/auth/finish', '/auth/sign-out', '/auth/oauth', '/auth/reset-password']

const SESSION_COOKIE = process.env.WORKOS_COOKIE_NAME || 'wos-session'

const AUTH_UNAVAILABLE_CODE = 'AUTH_UNAVAILABLE'
const AUTH_UNAVAILABLE_MESSAGE = 'Sign-in is unavailable right now. Try again shortly.'
const RETRY_SECONDS = 5

// A page load while the session can't be confirmed: it tries again by itself,
// and the session cookie is still there when WorkOS answers.
const UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_SECONDS}">
<title>Trying again · Olivetti</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    font: 16px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  p { margin: 0; max-width: 28rem; text-align: center; }
</style>
</head>
<body><p>Can't reach sign-in right now — trying again.</p></body>
</html>`

/**
 * True when a session cookie came in, AuthKit answered "no user", and AuthKit
 * did not delete the cookie. That is an outage, not a sign-out: AuthKit keeps
 * the cookie when a token refresh fails for a moment, or when WorkOS's signing
 * keys can't be fetched (which does not call `onSessionRefreshError`), and
 * deletes it whenever the session is really over (a refresh refused for good,
 * an invalid token, a cookie it can't read).
 */
function sessionUnconfirmed(request: NextRequest, user: unknown, authkitHeaders: Headers): boolean {
  if (user || !request.cookies.get(SESSION_COOKIE)?.value) return false
  const deleted = authkitHeaders
    .getSetCookie()
    .some((cookie) => cookie.split(';')[0].trim() === `${SESSION_COOKIE}=`)
  return !deleted
}

/** Answers a request whose session can't be confirmed right now, keeping AuthKit's other headers. */
function unavailable(request: NextRequest, authkitHeaders: Headers, path: string): NextResponse {
  const { responseHeaders } = partitionAuthkitHeaders(request, authkitHeaders)
  const headers = { 'cache-control': 'no-store', 'retry-after': String(RETRY_SECONDS) }
  // A Server Action (including AuthKit's own token refresh in the browser):
  // a failed answer, not a redirect, so the page and its unsaved work stay.
  const response = request.headers.has('next-action')
    ? new NextResponse(AUTH_UNAVAILABLE_MESSAGE, { status: 503, headers: { ...headers, 'content-type': 'text/plain' } })
    : path.startsWith('/api/')
      ? NextResponse.json({ error: AUTH_UNAVAILABLE_MESSAGE, code: AUTH_UNAVAILABLE_CODE }, { status: 503, headers })
      : new NextResponse(UNAVAILABLE_PAGE, { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  return applyResponseHeaders(response, responseHeaders)
}

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/api/inngest' ||
    request.nextUrl.pathname.startsWith('/api/webhooks/')
  ) {
    return NextResponse.next({ request })
  }

  // No eagerAuth: its token cookie is read before AuthKit knows the user, so
  // if another tab switches accounts meanwhile, AuthKit shows the new user
  // with the old account's token and keeps it, since nothing tells it the
  // user changed. Fetching the token once the user is known costs one request.
  const { session, headers } = await authkit(request)

  const path = request.nextUrl.pathname

  const isProtectedRoute =
    path === '/' ||
    PROTECTED_ROUTES.some(route => path === route || path.startsWith(`${route}/`))

  const isAuthRoute = AUTH_ROUTES.some(route =>
    path === route || path.startsWith(`${route}/`)
  )

  const isCallbackRoute = CALLBACK_ROUTES.some(route =>
    path === route || path.startsWith(`${route}/`)
  )

  if (isCallbackRoute) {
    return handleAuthkitHeaders(request, headers)
  }

  // A WorkOS outage: answer without sending anyone to sign in. The sign-in
  // pages themselves are left as they are.
  const isApiRoute = path.startsWith('/api/')
  if ((isProtectedRoute || isApiRoute) && sessionUnconfirmed(request, session.user, headers)) {
    return unavailable(request, headers, path)
  }

  if (isProtectedRoute && !session.user) {
    const next = `${path}${request.nextUrl.search}`
    const signIn = next === '/' ? '/auth' : `/auth?${new URLSearchParams({ next })}`
    // A Server Action from a page whose session ended elsewhere (signed out in
    // another tab). A plain redirect would be followed by the action's fetch
    // and ignored, leaving the page showing the old account. Next's own answer
    // for an action redirect is a 200 with `x-action-redirect`; with no Flight
    // body the client loads that page in full, so the old view is gone.
    if (request.headers.has('next-action')) {
      const { responseHeaders } = partitionAuthkitHeaders(request, headers)
      const response = new NextResponse(null, {
        status: 200,
        headers: { 'x-action-redirect': `${signIn};replace`, 'content-type': 'text/plain', 'cache-control': 'no-store' },
      })
      return applyResponseHeaders(response, responseHeaders)
    }
    return handleAuthkitHeaders(request, headers, { redirect: signIn })
  }

  if (isAuthRoute && session.user) {
    return handleAuthkitHeaders(request, headers, { redirect: '/' })
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
