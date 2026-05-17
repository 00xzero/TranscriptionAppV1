"use client"

import { useEffect } from 'react'
import { useRecordingSession } from './RecordingSessionContext'
import { hasUnsavedRecording } from './session'

export function useBeforeUnloadGuard(): void {
  useRecordingSession()
  const active = hasUnsavedRecording()

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
