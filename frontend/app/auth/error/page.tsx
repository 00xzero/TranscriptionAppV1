import { ErrorFallback } from '@/components/ErrorFallback'

// Where a failed sign-in callback lands (see app/auth/callback/route.ts).
export default function SignInError() {
  return (
    <ErrorFallback
      title="Couldn't sign you in"
      description="Sign-in didn't finish. The link may have expired or already been used. Please try again."
      primary={{ kind: 'document', label: 'Try again', href: '/auth' }}
    />
  )
}
