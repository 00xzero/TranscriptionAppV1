"use client"

import { useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import { getElapsedActiveMs } from '@/lib/recording/session'
import { formatElapsedTime } from '@/lib/recording/timeUtils'

interface RecordingTimerProps {
  className?: string
}

export default function RecordingTimer({ className }: RecordingTimerProps) {
  const snapshot = useRecordingSession()
  const elapsed = getElapsedActiveMs(snapshot)
  return (
    <span className={className} data-testid="recording-timer">
      {formatElapsedTime(elapsed)}
    </span>
  )
}
