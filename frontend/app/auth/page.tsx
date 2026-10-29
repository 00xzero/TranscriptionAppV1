import type { Metadata } from 'next'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { SignInForm, type PendingCode } from '@/components/auth/SignInForm'
import { SignInErrorSchema, type SignInError } from '@/contracts/auth'
import { codeAttempts } from '@/lib/auth/attempt-cookies.server'
import { safeReturnPath } from '@/lib/auth/return-path'

export const metadata: Metadata = { title: 'Sign in · Olivetti' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Our sign-in page, and where every sign-in starts and every failure lands.
 * Signed-in visitors never reach it (proxy.ts sends them to the Library).
 *
 * `next` is where to go afterwards; `error` a message from the callback or
 * /auth/finish; `mode=sign-up` opens account creation; `attempt` reopens a
 * pending code step (after Google/Microsoft, or a refresh), read from that
 * attempt's own cookie.
 */
export default async function AuthPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const next = safeReturnPath(one(params.next))
  const parsedError = SignInErrorSchema.safeParse(one(params.error))
  let initialError: SignInError | undefined = parsedError.success ? parsedError.data : undefined

  let pendingCode: PendingCode | null = null
  const attempt = one(params.attempt)
  if (attempt) {
    const pending = await codeAttempts.read(attempt)
    if (pending) pendingCode = { attempt, challenge: pending.challenge, email: pending.email }
    else initialError = 'code_expired'
  }

  return (
    <AuthFrame>
      <SignInForm
        next={next}
        clientId={process.env.WORKOS_CLIENT_ID}
        initialMode={one(params.mode) === 'sign-up' ? 'sign-up' : 'sign-in'}
        initialError={initialError}
        pendingCode={pendingCode}
      />
    </AuthFrame>
  )
}
