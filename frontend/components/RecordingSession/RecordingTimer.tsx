"use client"

import { useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import { getElapsedActiveMs } from '@/lib/recording/session'

function format(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

interface RecordingTimerProps {
  className?: string
}

export default function RecordingTimer({ className }: RecordingTimerProps) {
  const snapshot = useRecordingSession()
  const elapsed = getElapsedActiveMs(snapshot)
  return (
    <span className={className} data-testid="recording-timer">
      {format(elapsed)}
    </span>
  )
}
