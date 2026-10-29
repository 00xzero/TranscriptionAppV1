import type { Metadata } from 'next'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { SignInForm } from '@/components/auth/SignInForm'

export const metadata: Metadata = { title: 'Reset password · Olivetti' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

/**
 * Where WorkOS's password reset email links (its Password reset URL, set in
 * the WorkOS dashboard): a new password, then signed in. Without a token it
 * offers to send a new link.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { token } = await searchParams
  const resetToken = typeof token === 'string' && token ? token : undefined

  return (
    <AuthFrame>
      <SignInForm
        next="/"
        clientId={process.env.WORKOS_CLIENT_ID}
        resetToken={resetToken}
        initialError={resetToken ? undefined : 'reset_link'}
      />
    </AuthFrame>
  )
}
