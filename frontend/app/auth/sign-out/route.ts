/**
 * Sign-out: a form POST from AuthProvider, so the browser simply follows the
 * redirects (our session cookie cleared, then WorkOS's logout, then /auth).
 * Run as a Server Action instead, the page leaving mid-action rejects the
 * action's promise and the app reported a failed sign-out that had worked.
 *
 * AuthKit's `signOut()` clears the session cookie and ends with `redirect()`,
 * which a Route Handler answers with 307: after a POST that would POST again
 * to WorkOS. Its target is answered here with 303, which the browser follows
 * with a GET.
 *
 * The account cookie says `none`, so the app's other open tabs freeze.
 *
 * Only our own pages may post here: another site's form would otherwise sign
 * people out.
 */
import { signOut } from '@workos-inc/authkit-nextjs'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getURLFromRedirectError } from 'next/dist/client/components/redirect'
import { NextResponse } from 'next/server'
import { markAccount } from '@/lib/auth/account-marker.server'
import { appOrigin } from '@/lib/auth/origin.server'

export async function POST(request: Request) {
  const origin = appOrigin(request)
  if (request.headers.get('origin') !== origin) return new NextResponse(null, { status: 403 })
  await markAccount(null)
  try {
    await signOut({ returnTo: `${origin}/auth` })
  } catch (error) {
    if (isRedirectError(error)) {
      return NextResponse.redirect(getURLFromRedirectError(error), 303)
    }
    throw error
  }
  return NextResponse.redirect(`${origin}/auth`, 303)
}
