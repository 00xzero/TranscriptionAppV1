/**
 * Where Google and Microsoft sign-ins come back, by way of WorkOS (started by
 * app/auth/oauth/[provider]/route.ts). The attempt's own cookie, found by the
 * state in the URL, holds the PKCE verifier and destination; the code is then
 * exchanged with WorkOS and the sign-in finishes like every other: app_users,
 * the session cookie, then /auth/finish, which checks the cookie stuck.
 *
 * The attempt is spent whatever happens here (a code can be used once), so it
 * is cleared first. A failure lands on /auth with a message and the
 * destination kept; nothing restarts on its own, so nothing can loop. WorkOS
 * may still need an emailed code (an unconfirmed account with that email, or
 * Radar): that opens the code step.
 */
import { withAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { codeAttempts, oauthAttempts } from '@/lib/auth/attempt-cookies.server'
import { completeSignIn } from '@/lib/auth/complete-sign-in.server'
import { appOrigin, authUrl } from '@/lib/auth/origin.server'
import { exchangeOAuthCode } from '@/lib/auth/sign-in.server'

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const state = params.get('state') ?? ''
  const attempt = await oauthAttempts.read(state)

  if (!attempt) {
    // An old callback link for someone still signed in: nothing to sign in to.
    if ((await withAuth()).user) return noStore(NextResponse.redirect(new URL('/', appOrigin(request))))
    return noStore(NextResponse.redirect(authUrl({ error: 'oauth' }, request)))
  }
  await oauthAttempts.clear(state)

  const code = params.get('code')
  // The person cancelled at the provider, or WorkOS refused (?error=…).
  if (!code || params.has('error')) {
    return noStore(NextResponse.redirect(authUrl({ error: 'oauth', next: attempt.next }, request)))
  }

  const outcome = await exchangeOAuthCode({
    code,
    codeVerifier: attempt.codeVerifier,
    signalsId: attempt.signalsId,
  })

  if (outcome.kind === 'signed-in') {
    const finish = await completeSignIn(outcome.auth, attempt.next)
    return noStore(
      NextResponse.redirect(finish ?? authUrl({ error: 'not_finished', next: attempt.next }, request))
    )
  }
  if (outcome.kind === 'challenge') {
    const id = await codeAttempts.save({ ...outcome.attempt, next: attempt.next })
    return noStore(NextResponse.redirect(authUrl({ attempt: id, next: attempt.next }, request)))
  }
  const error = outcome.error === 'blocked' || outcome.error === 'unsupported' ? outcome.error : 'oauth'
  return noStore(NextResponse.redirect(authUrl({ error, next: attempt.next }, request)))
}
