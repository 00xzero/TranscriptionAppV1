'use server'

/**
 * The sign-in page's Server Actions. None of them redirects: a successful
 * sign-in returns the /auth/finish URL and the page loads it as a new page,
 * so the app always starts from fresh AuthKit state, and every way in passes
 * the same cookie check.
 *
 * Each is rate-limited per IP (per server instance only; WorkOS's own limits
 * and Radar are the real protection).
 */
import { checkRateLimit, RATE_LIMITS } from '@/core/limits/rate-limit'
import {
  AttemptIdSchema,
  CodeSchema,
  EmailSchema,
  PasswordSchema,
  SignalsIdSchema,
  type AuthActionResult,
} from '@/contracts/auth'
import { codeAttempts } from '@/lib/auth/attempt-cookies.server'
import { completeSignIn } from '@/lib/auth/complete-sign-in.server'
import { safeReturnPath } from '@/lib/auth/return-path'
import {
  createAccount,
  requestPasswordReset as askForResetEmail,
  resendVerification,
  resetPassword as setNewPassword,
  signInWithPassword,
  verifyCode as checkCode,
  visitor,
  type Authenticated,
} from '@/lib/auth/sign-in.server'

type Action = (previous: AuthActionResult, formData: FormData) => Promise<AuthActionResult>

const INVALID: AuthActionResult = { kind: 'error', error: 'invalid_input' }

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return typeof value === 'string' ? value : undefined
}

function signals(formData: FormData): string | undefined {
  const parsed = SignalsIdSchema.safeParse(text(formData, 'signalsId') || undefined)
  return parsed.success ? parsed.data : undefined
}

async function withSignInLimit(run: () => Promise<AuthActionResult>): Promise<AuthActionResult> {
  const { ipAddress } = await visitor()
  if (ipAddress && !checkRateLimit(`sign-in:${ipAddress}`, RATE_LIMITS.SIGN_IN).allowed) {
    return { kind: 'error', error: 'blocked' }
  }
  return run()
}

/** Where a WorkOS answer leads: finish signing in, a code step, or an error. */
async function after(outcome: Authenticated, next: string, email: string): Promise<AuthActionResult> {
  if (outcome.kind === 'signed-in') {
    const url = await completeSignIn(outcome.auth, next)
    return url ? { kind: 'finish', url } : { kind: 'error', error: 'not_finished' }
  }
  if (outcome.kind === 'challenge') {
    const shownEmail = outcome.attempt.email || email
    const attempt = await codeAttempts.save({ ...outcome.attempt, email: shownEmail, next })
    return { kind: 'code', attempt, challenge: outcome.attempt.challenge, email: shownEmail }
  }
  return outcome
}

export const signIn: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const email = EmailSchema.safeParse(text(formData, 'email'))
    const password = PasswordSchema.safeParse(text(formData, 'password'))
    if (!email.success || !password.success) return INVALID
    const next = safeReturnPath(text(formData, 'next'))

    const outcome = await signInWithPassword({ email: email.data, password: password.data, signalsId: signals(formData) })
    return after(outcome, next, email.data)
  })

export const signUp: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const email = EmailSchema.safeParse(text(formData, 'email'))
    const password = PasswordSchema.safeParse(text(formData, 'password'))
    if (!email.success || !password.success) return INVALID
    const next = safeReturnPath(text(formData, 'next'))
    const signalsId = signals(formData)

    const created = await createAccount({ email: email.data, password: password.data, signalsId })
    if (created.kind === 'error') return created

    const outcome = await signInWithPassword({
      email: email.data,
      password: password.data,
      signalsId,
      radarAuthAttemptId: created.radarAuthAttemptId,
    })
    // The account exists now, so a failed first sign-in must not leave the
    // person facing "email already taken" when they try again.
    if (outcome.kind === 'error') return { kind: 'notice', notice: 'account_created' }
    return after(outcome, next, email.data)
  })

export const verifyCode: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const id = AttemptIdSchema.safeParse(text(formData, 'attempt'))
    const code = CodeSchema.safeParse(text(formData, 'code'))
    if (!id.success) return { kind: 'error', error: 'code_expired' }
    if (!code.success) return { kind: 'error', error: 'invalid_code' }

    const pending = await codeAttempts.read(id.data)
    if (!pending) return { kind: 'error', error: 'code_expired' }

    const outcome = await checkCode(pending, code.data)
    // A wrong code, a WorkOS outage or a block keep the attempt for another
    // try; anything else spends it.
    if (outcome.kind === 'error' && outcome.error !== 'code_expired') return outcome
    await codeAttempts.clear(id.data)
    return after(outcome, pending.next, pending.email)
  })

export const resendCode: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const id = AttemptIdSchema.safeParse(text(formData, 'attempt'))
    if (!id.success) return { kind: 'error', error: 'code_expired' }
    const pending = await codeAttempts.read(id.data)
    // A Radar challenge has no resend: its screen offers Start again instead.
    if (!pending || pending.challenge !== 'email-verification' || !pending.emailVerificationId) {
      return { kind: 'error', error: 'code_expired' }
    }

    const sent = await resendVerification(pending.emailVerificationId)
    if (sent !== 'sent') {
      if (sent.error === 'code_expired') await codeAttempts.clear(id.data)
      return sent
    }
    return { kind: 'code', attempt: id.data, challenge: pending.challenge, email: pending.email, notice: 'code_sent' }
  })

export const requestPasswordReset: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const email = EmailSchema.safeParse(text(formData, 'email'))
    if (!email.success) return INVALID

    const sent = await askForResetEmail(email.data)
    return sent === 'sent' ? { kind: 'notice', notice: 'reset_sent' } : sent
  })

export const resetPassword: Action = async (_previous, formData) =>
  withSignInLimit(async () => {
    const token = text(formData, 'token')
    const password = PasswordSchema.safeParse(text(formData, 'password'))
    if (!token || !password.success) return INVALID
    const next = safeReturnPath(text(formData, 'next'))

    const reset = await setNewPassword(token, password.data)
    if (reset.kind === 'error') return reset

    // The reset link is used up now. If signing in with the new password fails,
    // say the password changed rather than sending them back to the old link.
    const outcome = await signInWithPassword({ email: reset.email, password: password.data, signalsId: signals(formData) })
    if (outcome.kind === 'error') return { kind: 'notice', notice: 'password_updated' }
    return after(outcome, next, reset.email)
  })
