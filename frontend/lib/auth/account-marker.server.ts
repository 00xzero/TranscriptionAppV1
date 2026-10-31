import 'server-only'

import { cookies } from 'next/headers'
import { ACCOUNT_MARKER_COOKIE, SIGNED_OUT_MARKER } from './account-marker'
import { secureCookies } from './origin.server'

// As long as AuthKit keeps its session cookie.
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

function maxAge(): number {
  const configured = Number.parseInt(process.env.WORKOS_COOKIE_MAX_AGE ?? '', 10)
  return Number.isFinite(configured) ? configured : DEFAULT_MAX_AGE_SECONDS
}

/**
 * Says which account the session now belongs to (see account-marker.ts).
 * Called wherever the session cookie is written or cleared, in that same
 * response. Readable by the page on purpose: it holds no secret.
 */
export async function markAccount(userId: string | null): Promise<void> {
  const jar = await cookies()
  jar.set(ACCOUNT_MARKER_COOKIE, userId ?? SIGNED_OUT_MARKER, {
    httpOnly: false,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    maxAge: maxAge(),
  })
}
