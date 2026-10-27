/**
 * Next.js Proxy for WorkOS AuthKit.
 *
 * - Refreshes the AuthKit session on every request (so `withAuth()` works in
 *   routes and pages)
 * - Sends signed-out visitors on protected routes to WorkOS sign-in, which
 *   returns them to the page they asked for
 */
import { authkit, handleAuthkitHeaders } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_ROUTES = ['/transcripts', '/editor', '/recording', '/projects', '/people']

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/auth']

// Routes that should be excluded from auth redirect logic (callbacks, etc).
// Sign-out is posted by signed-in visitors, so it must not bounce to /, and
// finish checks the session itself, so it must answer signed in or not.
const CALLBACK_ROUTES = ['/auth/callback', '/auth/finish', '/auth/sign-out']

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/inngest') {
    return NextResponse.next({ request })
  }

  const { session, headers, authorizationUrl } = await authkit(request)

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
    return handleAuthkitHeaders(request, headers, {
      redirect: authorizationUrl ?? '/auth',
    })
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
