/**
 * The last step of sign-in: the callback has set the session cookie and sends
 * the person here before the page they asked for. If the browser kept the
 * cookie they go on; if not (a cookie over the 4 KB browsers accept, or a
 * wrong cookie setting), every protected page would send them back through
 * WorkOS, which signs them straight in again, so they stop on /auth/error
 * instead, with a Try again.
 *
 * proxy.ts never redirects this route, signed in or not.
 */
import { withAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { safeReturnPath } from '@/lib/auth/sign-in-recovery.server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined

export async function GET(request: NextRequest) {
  const origin = baseURL ?? request.url
  const { user } = await withAuth()
  if (!user) return NextResponse.redirect(new URL('/auth/error?reason=session', origin))
  return NextResponse.redirect(new URL(safeReturnPath(request.nextUrl.searchParams.get('to')), origin))
}
