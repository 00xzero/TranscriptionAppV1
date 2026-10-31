import 'server-only'

import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import { ACCOUNT_MARKER_COOKIE, SIGNED_OUT_MARKER } from './account-marker'
import { secureCookies } from './origin.server'

// The longest browsers keep a cookie, whatever WORKOS_COOKIE_MAX_AGE says,
// so it outlasts the session even when a renewal happens out of the proxy's
// sight. Outliving the session does no harm: a signed-out page ignores it,
// and the next sign-in writes it again.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400

// Readable by the page on purpose: it holds no secret.
function markerOptions() {
  return { httpOnly: false, sameSite: 'lax' as const, secure: secureCookies(), path: '/', maxAge: MAX_AGE_SECONDS }
}

/**
 * Says which account the session now belongs to (see account-marker.ts).
 * Called wherever the session cookie is written or cleared, in that same
 * response.
 */
export async function markAccount(userId: string | null): Promise<void> {
  const jar = await cookies()
  jar.set(ACCOUNT_MARKER_COOKIE, userId ?? SIGNED_OUT_MARKER, markerOptions())
}

/**
 * AuthKit starts its session cookie's lifetime again on every renewal, so
 * the account cookie must too, or it would run out while the session lives
 * on and every page would ask for a fresh sign-in. Only a signed-in account
 * is renewed: `none` and a missing cookie are left as they are.
 */
function signedInMark(value: string | undefined): string | null {
  return value && value !== SIGNED_OUT_MARKER ? value : null
}

/** For a route that renewed the session itself (infra/supabase/server.ts). */
export async function renewAccountMark(): Promise<void> {
  const jar = await cookies()
  const userId = signedInMark(jar.get(ACCOUNT_MARKER_COOKIE)?.value)
  if (userId) jar.set(ACCOUNT_MARKER_COOKIE, userId, markerOptions())
}

/** For the proxy, after AuthKit has renewed the session cookie. */
export function renewAccountMarkOn(request: NextRequest, response: NextResponse): void {
  const userId = signedInMark(request.cookies.get(ACCOUNT_MARKER_COOKIE)?.value)
  if (userId) response.cookies.set(ACCOUNT_MARKER_COOKIE, userId, markerOptions())
}
