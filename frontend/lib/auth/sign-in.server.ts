import 'server-only'

import { getWorkOS } from '@workos-inc/authkit-nextjs'
import type { AuthenticationResponse } from '@workos-inc/node'
import { headers } from 'next/headers'
import type { SignInError } from '@/contracts/auth'
import type { PendingCodeAttempt } from './attempt-cookies.server'
import { authDiagnostics } from './diagnostics'

/**
 * Our own sign-in's calls to WorkOS, and what each WorkOS answer means for the
 * page. Every authenticate call carries the visitor's IP and browser and,
 * when the page could get one, Radar's signals token, so WorkOS's bot
 * protection sees what it would on the hosted page.
 *
 * WorkOS's own messages are never shown: they include the email address.
 */

export type Authenticated =
  | { kind: 'signed-in'; auth: AuthenticationResponse }
  // An emailed code is needed first: confirming a new address, or Radar asking.
  | { kind: 'challenge'; attempt: PendingCodeAttempt }
  | { kind: 'error'; error: SignInError; detail?: string }

type Failure = Extract<Authenticated, { kind: 'error' }>

interface WorkOSError {
  name?: string
  status?: number
  code?: string
  error?: string
  errors?: Array<{ code?: string; message?: string }>
  rawData?: {
    email?: unknown
    email_verification_id?: unknown
    user?: { email?: unknown }
  }
  pendingAuthenticationToken?: string
  radarChallengeId?: string
}

const UNSUPPORTED = new Set([
  'mfa_enrollment',
  'mfa_challenge',
  'mfa_verification',
  'organization_selection_required',
  'sso_required',
])

function clientId(): string {
  const value = process.env.WORKOS_CLIENT_ID
  if (!value) throw new Error('WORKOS_CLIENT_ID is not set')
  return value
}

/**
 * The visitor's IP and browser, for WorkOS's bot protection and our rate
 * limit. Trusts the IP headers as Vercel sets them: it overwrites both with
 * the client's address. Behind a proxy that appends to them instead, the
 * first entry would be the browser's own claim.
 */
export async function visitor(): Promise<{ ipAddress?: string; userAgent?: string }> {
  const list = await headers()
  const ip = list.get('x-real-ip') ?? list.get('x-forwarded-for')?.split(',')[0]?.trim()
  return { ipAddress: ip || undefined, userAgent: list.get('user-agent') ?? undefined }
}

/**
 * What a WorkOS error means for the page. `during` says what was being
 * attempted, since a plain 400 means a wrong code while verifying.
 */
function describe(raw: unknown, during: 'password' | 'sign-up' | 'code' | 'oauth' | 'reset'): Authenticated {
  const e = (raw ?? {}) as WorkOSError
  const code = e.code ?? e.error

  if (e.name === 'AuthenticationException' && e.pendingAuthenticationToken) {
    const data = e.rawData ?? {}
    // Email verification uses email; Radar nests it under user.
    const email = typeof data.email === 'string'
      ? data.email
      : typeof data.user?.email === 'string' ? data.user.email : ''
    if (code === 'email_verification_required') {
      const id = data.email_verification_id
      return {
        kind: 'challenge',
        attempt: {
          challenge: 'email-verification',
          pendingAuthenticationToken: e.pendingAuthenticationToken,
          email,
          emailVerificationId: typeof id === 'string' ? id : undefined,
        },
      }
    }
    if (code === 'radar_email_challenge' && e.radarChallengeId) {
      return {
        kind: 'challenge',
        attempt: {
          challenge: 'radar',
          pendingAuthenticationToken: e.pendingAuthenticationToken,
          email,
          radarChallengeId: e.radarChallengeId,
        },
      }
    }
  }

  if (code && UNSUPPORTED.has(code)) return failure('unsupported')
  // Radar's block, a text-message challenge (not enabled here), or too many tries.
  if (code === 'policy_denied' || code === 'radar_sms_challenge' || e.name === 'RateLimitExceededException') {
    return failure('blocked')
  }
  if (code === 'invalid_credentials') return failure('invalid_credentials')
  if (code === 'invalid_pending_authentication_token') return failure('code_expired')
  // A weak password: its own code on sign-up, but on a reset it comes as
  // `password_reset_error` with the reasons nested (`password_too_short`), and
  // the link still works, so it must not read as a dead link.
  const strength = code === 'password_strength_error'
    ? e.errors ?? []
    : code === 'password_reset_error'
      ? (e.errors ?? []).filter((item) => item.code?.startsWith('password_') && !item.code.startsWith('password_reset'))
      : []
  if (code === 'password_strength_error' || strength.length > 0) {
    const reasons = strength.map((item) => item.message?.trim()).filter(Boolean)
    return { kind: 'error', error: 'weak_password', detail: reasons[0] }
  }
  if (code === 'user_creation_error' && e.errors?.some((item) => item.code === 'email_not_available')) {
    return failure('email_taken')
  }
  if (code?.startsWith('password_reset')) return failure('reset_link')
  // A used, expired or mismatched sign-in code from Google/Microsoft.
  if (e.name === 'OauthException') return failure(during === 'oauth' ? 'oauth' : 'service')
  // While verifying, WorkOS answers a wrong or expired code with a 400.
  if (during === 'code' && e.status === 400) return failure('invalid_code')
  return failure('service')
}

function failure(error: SignInError): Failure {
  return { kind: 'error', error }
}

async function attempt(
  during: Parameters<typeof describe>[1],
  call: () => Promise<AuthenticationResponse>
): Promise<Authenticated> {
  const diagnose = authDiagnostics(during)
  try {
    return { kind: 'signed-in', auth: await call() }
  } catch (error) {
    const outcome = describe(error, during)
    if (outcome.kind === 'error' && outcome.error === 'service') diagnose('failed', error)
    return outcome
  }
}

const userManagement = () => getWorkOS().userManagement

export async function signInWithPassword(input: {
  email: string
  password: string
  signalsId?: string
  radarAuthAttemptId?: string
}): Promise<Authenticated> {
  const who = await visitor()
  return attempt('password', () =>
    userManagement().authenticateWithPassword({ clientId: clientId(), ...input, ...who })
  )
}

export async function createAccount(input: {
  email: string
  password: string
  signalsId?: string
}): Promise<{ kind: 'created'; radarAuthAttemptId?: string } | Failure> {
  const who = await visitor()
  const diagnose = authDiagnostics('sign-up')
  try {
    const user = await userManagement().createUser({ ...input, ...who })
    return { kind: 'created', radarAuthAttemptId: user.radarAuthAttemptId }
  } catch (error) {
    const outcome = describe(error, 'sign-up')
    if (outcome.kind !== 'error') return failure('service')
    if (outcome.error === 'service') diagnose('failed', error)
    return outcome
  }
}

export async function verifyCode(pending: PendingCodeAttempt, code: string): Promise<Authenticated> {
  const who = await visitor()
  const base = { clientId: clientId(), code, pendingAuthenticationToken: pending.pendingAuthenticationToken, ...who }
  return attempt('code', () =>
    pending.challenge === 'radar'
      ? userManagement().authenticateWithRadarEmailChallenge({ ...base, radarChallengeId: pending.radarChallengeId })
      : userManagement().authenticateWithEmailVerification(base)
  )
}

export async function exchangeOAuthCode(input: {
  code: string
  codeVerifier: string
  signalsId?: string
}): Promise<Authenticated> {
  const who = await visitor()
  return attempt('oauth', () => userManagement().authenticateWithCode({ clientId: clientId(), ...input, ...who }))
}

/** Sends a new confirmation code. The user id comes from WorkOS, never from the browser. */
export async function resendVerification(emailVerificationId: string): Promise<'sent' | Failure> {
  const diagnose = authDiagnostics('resend')
  try {
    const verification = await userManagement().getEmailVerification(emailVerificationId)
    await userManagement().sendVerificationEmail({ userId: verification.userId })
    return 'sent'
  } catch (error) {
    // Not found: the verification is gone, so the person starts again.
    if ((error as WorkOSError).status === 404) return failure('code_expired')
    diagnose('failed', error)
    return failure('service')
  }
}

/**
 * Asks WorkOS to email a reset link. Whether the address has an account is
 * never revealed: only a WorkOS outage is reported.
 */
export async function requestPasswordReset(email: string): Promise<'sent' | Failure> {
  const diagnose = authDiagnostics('reset-request')
  try {
    await userManagement().createPasswordReset({ email })
  } catch (error) {
    const status = (error as WorkOSError).status
    if (status === undefined || status >= 500) {
      diagnose('failed', error)
      return failure('service')
    }
  }
  return 'sent'
}

export async function resetPassword(token: string, newPassword: string): Promise<{ kind: 'reset'; email: string } | Failure> {
  const diagnose = authDiagnostics('reset')
  try {
    const { user } = await userManagement().resetPassword({ token, newPassword })
    return { kind: 'reset', email: user.email }
  } catch (error) {
    const outcome = describe(error, 'reset')
    if (outcome.kind !== 'error') return failure('service')
    if (outcome.error === 'service') diagnose('failed', error)
    return outcome
  }
}
