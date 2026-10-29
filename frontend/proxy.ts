/**
 * Next.js Proxy for WorkOS AuthKit.
 *
 * - Refreshes the AuthKit session on every request (so `withAuth()` works in
 *   routes and pages)
 * - Sends signed-out visitors on protected routes to our sign-in page
 *   (app/auth/page.tsx), which returns them to the page they asked for
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

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/inngest') {
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
