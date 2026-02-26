/**
 * Next.js Middleware for Supabase Auth.
 * 
 * - Refreshes auth tokens on every request
 * - Redirects unauthenticated users to /auth for protected routes
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_ROUTES = ['/projects', '/editor']

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/auth']

// Routes that should be excluded from auth redirect logic (callbacks, etc)
const CALLBACK_ROUTES = ['/auth/callback']
const SUPABASE_COOKIE_NAME =
  process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME || 'sb-local-auth-token'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Use SUPABASE_URL for server-side (Docker), fallback to NEXT_PUBLIC for browser
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!

  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
      cookieOptions: {
        // Use consistent cookie name for local dev (different URLs for client/server in Docker)
        name: SUPABASE_COOKIE_NAME,
      }
    }
  )

  // IMPORTANT: Do not use supabase.auth.getSession() here.
  // getUser() is safer as it validates the JWT with the server.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const redirectWithSupabaseResponse = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url)
    // Only forward cookies from the Supabase response. Copying headers from
    // NextResponse.next() can leak internal x-middleware control headers onto
    // redirects and interfere with redirect handling.

    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }

    return redirectResponse
  }

  const path = request.nextUrl.pathname

  // Check if the path is protected
  const isProtectedRoute =
    path === '/' ||
    PROTECTED_ROUTES.some(route => path === route || path.startsWith(`${route}/`))

  // Check if the path is an auth route
  const isAuthRoute = AUTH_ROUTES.some(route =>
    path === route || path.startsWith(`${route}/`)
  )

  // Check if the path is a callback route (skip redirect logic)
  const isCallbackRoute = CALLBACK_ROUTES.some(route =>
    path === route || path.startsWith(`${route}/`)
  )

  // Skip redirect logic for callback routes
  if (isCallbackRoute) {
    return supabaseResponse
  }

  // Redirect unauthenticated users away from protected routes
  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return redirectWithSupabaseResponse(url)
  }

  // Redirect authenticated users away from auth routes
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return redirectWithSupabaseResponse(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
