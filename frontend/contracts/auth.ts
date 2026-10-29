import { z } from 'zod'

// Shapes for our own sign-in page (app/auth): what its forms send, and what
// its Server Actions answer.

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320))

// WorkOS enforces the real password rules (10+ characters, strength), so this
// only bounds the input.
export const PasswordSchema = z.string().min(1).max(256)

export const CodeSchema = z.string().trim().regex(/^\d{6}$/)

export const OAuthProviderSchema = z.enum(['google', 'microsoft'])
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>

/** Which kind of emailed code a pending sign-in waits for. */
export const ChallengeSchema = z.enum(['email-verification', 'radar'])
export type Challenge = z.infer<typeof ChallengeSchema>

/** Names a pending code attempt; the page only ever holds this, never the token. */
export const AttemptIdSchema = z.string().regex(/^[a-z0-9]{6,12}-[a-f0-9]{24}$/)

/** Radar's browser signals token, passed through to WorkOS as it is. */
export const SignalsIdSchema = z.string().min(1).max(4096).optional()

export const SignInErrorSchema = z.enum([
  'invalid_input',
  'invalid_credentials',
  'email_taken',
  'weak_password',
  'invalid_code',
  // The pending attempt is gone (expired, used, or never ours): start again.
  'code_expired',
  'reset_link',
  'blocked',
  'unsupported',
  'service',
  // WorkOS signed the person in, but we could not finish (app_users or the
  // session cookie): the attempt is spent, so they sign in again.
  'not_finished',
  'oauth',
  'session',
])
export type SignInError = z.infer<typeof SignInErrorSchema>

export const AuthNoticeSchema = z.enum(['account_created', 'password_updated', 'reset_sent', 'code_sent'])
export type AuthNotice = z.infer<typeof AuthNoticeSchema>

export const AuthActionResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({ kind: z.literal('finish'), url: z.string() }),
  z.object({
    kind: z.literal('code'),
    attempt: AttemptIdSchema,
    challenge: ChallengeSchema,
    email: z.string(),
    notice: AuthNoticeSchema.optional(),
  }),
  z.object({
    kind: z.literal('error'),
    error: SignInErrorSchema,
    // WorkOS's own reason, only for a weak password.
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal('notice'), notice: AuthNoticeSchema }),
])
export type AuthActionResult = z.infer<typeof AuthActionResultSchema>
