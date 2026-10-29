/**
 * The last step of every sign-in: the session cookie has just been set, and
 * the person comes here before the page they asked for. If the browser kept
 * the cookie they go on; if not (a cookie over the 4 KB browsers accept, or a
 * wrong cookie setting), they stop on /auth with a message and their
 * destination kept, instead of being sent round again.
 *
 * proxy.ts never redirects this route, signed in or not.
 */
import { withAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin, authUrl } from '@/lib/auth/origin.server'
import { safeReturnPath } from '@/lib/auth/return-path'

export async function GET(request: NextRequest) {
  const to = safeReturnPath(request.nextUrl.searchParams.get('to'))
  const { user } = await withAuth()
  if (!user) return NextResponse.redirect(authUrl({ error: 'session', next: to }, request))
  return NextResponse.redirect(new URL(to, appOrigin(request)))
}
