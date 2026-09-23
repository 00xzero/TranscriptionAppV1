'use client'

import { useEffect, useState, type ReactNode } from 'react'

type LoadingStatusProps = {
  message: string
  children?: ReactNode
  className?: string
}

/**
 * Long enough for assistive tech to register the empty live region before text lands in
 * it (VoiceOver misses same-frame updates); loads shorter than this stay silent.
 */
const ANNOUNCE_DELAY_MS = 100

/** Add the announcement after the empty live region has mounted. */
export function LoadingStatus({ message, children, className }: LoadingStatusProps) {
  const [announcement, setAnnouncement] = useState({ message, text: '' })

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAnnouncement({ message, text: message })
    }, ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [message])

  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">
        {announcement.message === message ? announcement.text : ''}
      </span>
      {children}
    </div>
  )
}
