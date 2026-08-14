/**
 * Next.js Proxy for Supabase Auth.
 *
 * - Refreshes auth tokens on every request
 * - Redirects unauthenticated users to /auth for protected routes
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getServerSupabaseCookieName } from '@/infra/supabase/cookie'

// Routes that require authentication
const PROTECTED_ROUTES = ['/transcripts', '/editor', '/recording']

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/auth']

// Routes that should be excluded from auth redirect logic (callbacks, etc)
const CALLBACK_ROUTES = ['/auth/callback']

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/inngest') {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  // Use SUPABASE_URL for server-side (Docker), fallback to NEXT_PUBLIC for browser
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const missingEnvVars: string[] = []

  if (!supabaseUrl) {
    missingEnvVars.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!supabaseAnonKey) {
    missingEnvVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  if (missingEnvVars.length > 0) {
    const message = `[proxy] Missing required Supabase environment variable(s): ${missingEnvVars.join(', ')}`
    console.error(message)
    throw new Error(message)
  }

  const validatedSupabaseUrl = supabaseUrl as string
  const validatedSupabaseAnonKey = supabaseAnonKey as string
  const supabaseCookieName = getServerSupabaseCookieName(
    validatedSupabaseUrl,
    request.cookies.getAll()
  )

  const supabase = createServerClient(
    validatedSupabaseUrl,
    validatedSupabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value)
          })
        },
      },
      cookieOptions: {
        // Reuse legacy cookies when present, otherwise keep a stable local name.
        name: supabaseCookieName,
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

    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }

    return redirectResponse
  }

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
    return supabaseResponse
  }

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return redirectWithSupabaseResponse(url)
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return redirectWithSupabaseResponse(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
