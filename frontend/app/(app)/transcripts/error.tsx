"use client"

import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'

export default function TranscriptsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Transcripts route error boundary caught:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Couldn't load transcripts"
      description="We hit an error loading your transcripts list. This is usually temporary — try again in a moment."
      digest={error.digest}
      primary={{ kind: 'button', label: 'Try again', onClick: reset }}
      secondary={{ kind: 'link', label: 'Back to home', href: '/' }}
    />
  )
}
