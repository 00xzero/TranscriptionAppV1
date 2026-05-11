"use client"

import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'

export default function ProjectsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Projects route error boundary caught:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Couldn't load projects"
      description="We hit an error loading your projects list. This is usually temporary — try again in a moment."
      digest={error.digest}
      primary={{ kind: 'button', label: 'Try again', onClick: reset }}
      secondary={{ kind: 'link', label: 'Back to home', href: '/' }}
    />
  )
}
