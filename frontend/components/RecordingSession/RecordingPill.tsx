"use client"

import { useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { getElapsedActiveMs } from '@/lib/recording/session'
import { formatElapsedTime } from '@/lib/recording/timeUtils'

export default function RecordingPill() {
  const guardedNav = useGuardedNavigate()
  const snapshot = useRecordingSession()
  const state = snapshot.state
  const isPaused = state === 'paused'
  const isActive = state === 'recording' || isPaused

  if (!isActive) {
    return null
  }

  const elapsed = getElapsedActiveMs(snapshot)

  return (
    <button
      type="button"
      onClick={() => guardedNav.push('/recording/new')}
      aria-label="Return to recording session"
      data-testid="recording-pill"
      className="flex items-center gap-2 rounded-full bg-night-surface px-3 py-1.5 text-xs font-medium text-paper shadow-xs transition-all hover:shadow-md active:scale-95"
    >
      <span
        className={`h-2 w-2 rounded-full bg-ember-red ${isPaused ? '' : 'animate-pulse'}`}
        aria-hidden="true"
      />
      <span className="font-mono">
        {isPaused ? 'Paused' : 'Recording'} {formatElapsedTime(elapsed)}
      </span>
    </button>
  )
}
