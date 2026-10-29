"use client"

import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'

export default function EditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Editor route error boundary caught:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Couldn't open this transcript"
      description="The editor failed to render this transcript. Try again, or return to your transcripts list to pick another."
      digest={error.digest}
      primary={{ kind: 'button', label: 'Try again', onClick: reset }}
      secondary={{ kind: 'link', label: 'Back to transcripts', href: '/transcripts' }}
    />
  )
}
