import { ErrorFallback } from '@/components/ErrorFallback'

// Where a failed sign-in lands: a failed callback (app/auth/callback/route.ts),
// or a session cookie the browser didn't keep (reason=session, from
// app/auth/finish/route.ts).
export default async function SignInError({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { reason } = await searchParams

  if (reason === 'session') {
    return (
      <ErrorFallback
        title="Couldn't keep you signed in"
        description="You signed in, but your browser didn't keep the sign-in. Check that cookies are allowed for this site, then try again."
        primary={{ kind: 'document', label: 'Try again', href: '/auth' }}
      />
    )
  }

  return (
    <ErrorFallback
      title="Couldn't sign you in"
      description="Sign-in didn't finish. The link may have expired or already been used. Please try again."
      primary={{ kind: 'document', label: 'Try again', href: '/auth' }}
    />
  )
}
