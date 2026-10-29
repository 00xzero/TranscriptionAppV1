/**
 * Starts a Google or Microsoft sign-in: the page's button posts here with the
 * destination and Radar's signals token. A new attempt (PKCE verifier, state,
 * destination, signals) is sealed into its own cookie, and the browser goes
 * straight to the provider by way of WorkOS, without its hosted page. The
 * provider returns to /auth/callback.
 *
 * A POST only, from our own page: a GET (an old link) goes back to /auth.
 */
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { OAuthProviderSchema, SignalsIdSchema, type OAuthProvider } from '@/contracts/auth'
import { newAttemptId, oauthAttempts } from '@/lib/auth/attempt-cookies.server'
import { appOrigin, authUrl, redirectUri } from '@/lib/auth/origin.server'
import { safeReturnPath } from '@/lib/auth/return-path'

const WORKOS_PROVIDER: Record<OAuthProvider, 'GoogleOAuth' | 'MicrosoftOAuth'> = {
  google: 'GoogleOAuth',
  microsoft: 'MicrosoftOAuth',
}

type Context = { params: Promise<{ provider: string }> }

export async function POST(request: NextRequest, { params }: Context) {
  const provider = OAuthProviderSchema.safeParse((await params).provider)
  if (!provider.success) return new NextResponse(null, { status: 404 })
  if (request.headers.get('origin') !== appOrigin(request)) return new NextResponse(null, { status: 403 })

  const form = await request.formData()
  const nextField = form.get('next')
  const next = safeReturnPath(typeof nextField === 'string' ? nextField : null)
  const signalsField = form.get('signalsId')
  const signals = SignalsIdSchema.safeParse(typeof signalsField === 'string' && signalsField ? signalsField : undefined)

  const workos = getWorkOS()
  const pkce = await workos.pkce.generate()
  const state = newAttemptId()
  await oauthAttempts.save({
    state,
    provider: provider.data,
    codeVerifier: pkce.codeVerifier,
    next,
    signalsId: signals.success ? signals.data : undefined,
  })

  const url = workos.userManagement.getAuthorizationUrl({
    provider: WORKOS_PROVIDER[provider.data],
    clientId: process.env.WORKOS_CLIENT_ID!,
    redirectUri: redirectUri ?? new URL('/auth/callback', appOrigin(request)).toString(),
    state,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  })
  const response = NextResponse.redirect(url, 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export function GET(request: NextRequest) {
  return NextResponse.redirect(authUrl({}, request))
}
