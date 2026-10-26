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
 */
import { signOut } from '@workos-inc/authkit-nextjs'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getURLFromRedirectError } from 'next/dist/client/components/redirect'
import { NextResponse } from 'next/server'

// The browser-facing origin, which a container's request URL may not carry.
const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI

export async function POST(request: Request) {
  const origin = redirectUri ? new URL(redirectUri).origin : new URL(request.url).origin
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
