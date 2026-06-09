"use client"

import { useEffect } from 'react'
import { useRecordingSession } from './RecordingSessionContext'
import { isRecordingSessionActive } from './session'

export function useBeforeUnloadGuard(): void {
  const snapshot = useRecordingSession()
  const active = isRecordingSessionActive(snapshot)

  useEffect(() => {
    if (!active) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Modern browsers ignore the returned string, but a non-empty value is
      // required to trigger the native warning in some legacy paths.
      event.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
