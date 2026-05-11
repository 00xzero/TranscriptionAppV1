"use client"

import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Root error boundary caught:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Something went wrong"
      description="The app hit an unexpected error and couldn't finish rendering this page. You can try again, or head back home."
      digest={error.digest}
      primary={{ kind: 'button', label: 'Try again', onClick: reset }}
      secondary={{ kind: 'link', label: 'Back to home', href: '/' }}
    />
  )
}
