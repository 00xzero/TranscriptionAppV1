"use client"

import { useRouter } from 'next/navigation'
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

export default function RecordingPill() {
  const router = useRouter()
  const snapshot = useRecordingSession()

  if (snapshot.state !== 'recording' && snapshot.state !== 'paused') {
    return null
  }

  const elapsed = getElapsedActiveMs(snapshot)
  const isPaused = snapshot.state === 'paused'

  return (
    <button
      type="button"
      onClick={() => router.push('/recording/new')}
      aria-label="Return to recording session"
      data-testid="recording-pill"
      className="flex items-center gap-2 rounded-full bg-night-surface px-3 py-1.5 text-xs font-medium text-paper shadow-xs transition-all hover:shadow-md active:scale-95"
    >
      <span
        className={`h-2 w-2 rounded-full bg-ember-red ${isPaused ? '' : 'animate-pulse'}`}
        aria-hidden="true"
      />
      <span className="font-mono">
        {isPaused ? 'Paused' : 'Recording'} {format(elapsed)}
      </span>
    </button>
  )
}
