import 'server-only'

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { sealData, unsealData } from 'iron-session'
import { z } from 'zod'
import { AttemptIdSchema, OAuthProviderSchema } from '@/contracts/auth'
import { secureCookies } from './origin.server'

/**
 * Sign-in attempts in flight, each in its own sealed cookie, so two tabs never
 * overwrite each other: a Google/Microsoft attempt (its PKCE verifier, state,
 * destination and Radar signals) and an emailed-code attempt (WorkOS's pending
 * token, which never reaches the browser). The page only holds an attempt id.
 *
 * Every cookie is HttpOnly, SameSite=Lax (the OAuth one must come back on the
 * provider's top-level redirect), Secure when the app is served over https,
 * scoped to /auth, and lasts 10 minutes, which iron-session also seals into
 * the value. At most 5 of each kind are kept, as AuthKit does for its own
 * PKCE cookies, so request headers can't grow without limit: a sixth replaces
 * the oldest.
 */

const TTL_SECONDS = 600
const MAX_PER_KIND = 5
const PATH = '/auth'

const OAUTH_PREFIX = 'olivetti-oauth-'
const CODE_PREFIX = 'olivetti-code-'

/** A sortable id: its first part is the creation time, so the oldest sorts first. */
export function newAttemptId(): string {
  return `${Date.now().toString(36)}-${randomBytes(12).toString('hex')}`
}

export const OAuthAttemptSchema = z.object({
  state: AttemptIdSchema,
  provider: OAuthProviderSchema,
  codeVerifier: z.string().min(43),
  next: z.string(),
  signalsId: z.string().optional(),
})
export type OAuthAttempt = z.infer<typeof OAuthAttemptSchema>

export const CodeAttemptSchema = z.discriminatedUnion('challenge', [
  z.object({
    challenge: z.literal('email-verification'),
    pendingAuthenticationToken: z.string().min(1),
    email: z.string(),
    emailVerificationId: z.string().optional(),
    next: z.string(),
  }),
  z.object({
    challenge: z.literal('radar'),
    pendingAuthenticationToken: z.string().min(1),
    email: z.string(),
    radarChallengeId: z.string().min(1),
    next: z.string(),
  }),
])
export type CodeAttempt = z.infer<typeof CodeAttemptSchema>
/** A code attempt as WorkOS describes it, before its destination is added. */
export type PendingCodeAttempt = CodeAttempt extends infer T ? (T extends unknown ? Omit<T, 'next'> : never) : never

function password(): string {
  const value = process.env.WORKOS_COOKIE_PASSWORD
  if (!value || value.length < 32) throw new Error('WORKOS_COOKIE_PASSWORD must be at least 32 characters')
  return value
}

async function write(prefix: string, id: string, value: unknown): Promise<void> {
  const jar = await cookies()
  // Make room: drop the oldest of this kind once there are already five.
  const existing = jar
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => name.startsWith(prefix))
    .sort()
  for (const name of existing.slice(0, Math.max(0, existing.length - (MAX_PER_KIND - 1)))) {
    jar.delete({ name, path: PATH })
  }
  const sealed = await sealData(value, { password: password(), ttl: TTL_SECONDS })
  jar.set(`${prefix}${id}`, sealed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: PATH,
    maxAge: TTL_SECONDS,
  })
}

async function read<T>(prefix: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
  if (!AttemptIdSchema.safeParse(id).success) return null
  const jar = await cookies()
  const sealed = jar.get(`${prefix}${id}`)?.value
  if (!sealed) return null
  let value: unknown
  try {
    // A tampered or expired seal unseals to {} or throws; either fails the schema.
    value = await unsealData(sealed, { password: password(), ttl: TTL_SECONDS })
  } catch {
    return null
  }
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}

async function clear(prefix: string, id: string): Promise<void> {
  if (!AttemptIdSchema.safeParse(id).success) return
  const jar = await cookies()
  jar.delete({ name: `${prefix}${id}`, path: PATH })
}

export const oauthAttempts = {
  save: (attempt: OAuthAttempt) => write(OAUTH_PREFIX, attempt.state, attempt),
  read: (state: string) => read(OAUTH_PREFIX, state, OAuthAttemptSchema),
  clear: (state: string) => clear(OAUTH_PREFIX, state),
}

export const codeAttempts = {
  /** Saves a pending code attempt and returns its id, the only part the page sees. */
  save: async (attempt: CodeAttempt): Promise<string> => {
    const id = newAttemptId()
    await write(CODE_PREFIX, id, attempt)
    return id
  },
  read: (id: string) => read(CODE_PREFIX, id, CodeAttemptSchema),
  clear: (id: string) => clear(CODE_PREFIX, id),
}
