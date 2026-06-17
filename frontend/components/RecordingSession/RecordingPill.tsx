"use client"

import { useRecordingSession } from '@/lib/recording/RecordingSessionContext'
import { useGuardedNavigate } from '@/lib/recording/guardedNavigation'
import { getElapsedActiveMs } from '@/lib/recording/session'
import type { RecordingState } from '@/lib/recording/session'
import { formatElapsedTime } from '@/lib/recording/timeUtils'

// Phase 3: the pill is the way back to `/recording/new` from anywhere in the app,
// so it must stay visible for every state the user still has to resolve — not just
// recording/paused. Polished/animated variants and the hover preview are Phase 5.
const PILL_STATES: ReadonlySet<RecordingState> = new Set<RecordingState>([
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'error',
  'recoverable',
])

export default function RecordingPill() {
  const guardedNav = useGuardedNavigate()
  const snapshot = useRecordingSession()
  const state = snapshot.state

  // The error pill only matters while there is something to retry; a terminal
  // non-retryable error has nothing for the user to return to.
  if (!PILL_STATES.has(state)) return null
  if (state === 'error' && !snapshot.canRetryUpload) return null

  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const isAttention = state === 'error' || state === 'recoverable'

  let label: string
  if (isRecording) {
    label = `Recording ${formatElapsedTime(getElapsedActiveMs(snapshot))}`
  } else if (isPaused) {
    label = `Paused ${formatElapsedTime(getElapsedActiveMs(snapshot))}`
  } else if (state === 'finalizing') {
    label = 'Finalizing…'
  } else if (state === 'uploading') {
    label = 'Uploading…'
  } else if (state === 'error') {
    label = 'Recording error'
  } else {
    label = 'Recovered recording'
  }

  return (
    <button
      type="button"
      onClick={() => guardedNav.push('/recording/new')}
      aria-label="Return to recording session"
      data-testid="recording-pill"
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-xs transition-all hover:shadow-md active:scale-95 ${
        isAttention
          ? 'border-ember-red/50 bg-ember-red/10 text-ember-red dark:bg-ember-red/15'
          : 'border-base bg-surface text-ink hover:bg-paper dark:bg-night-surface dark:text-paper dark:hover:bg-night-surface/80'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full bg-ember-red ${isRecording ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span className="font-mono">{label}</span>
    </button>
  )
}
