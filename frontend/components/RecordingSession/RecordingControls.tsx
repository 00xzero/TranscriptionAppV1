"use client"
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import {
  getElapsedActiveMs,
} from '@/lib/recording/session'
import { meetsEmptyFloor } from '@/lib/recording/sizeBudget'

export default function RecordingControls() {
  const snapshot = useRecordingSession()
  const actions = useRecordingActions()

  const state = snapshot.state
  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const disabled = !isRecording && !isPaused

  const activeMs = getElapsedActiveMs(snapshot)
  const aboveFloor = meetsEmptyFloor(activeMs, snapshot.bytesSoFar)

  const handleStop = () => {
    void actions.stopAndFinalize()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="recording-controls">
      {!aboveFloor && !disabled && (
        <div
          role="status"
          aria-live="polite"
          data-testid="recording-empty-floor-banner"
          className="rounded-md border border-ink/15 bg-ink/5 px-3 py-2 text-sm text-ink/80 dark:border-night-border dark:bg-night-surface/40 dark:text-paper/70"
        >
          Recording is too short to transcribe. Resume to keep recording, or discard to start over.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isPaused ? (
          <button
            type="button"
            onClick={actions.resume}
            className="rounded-sm bg-trust-blue px-4 py-2 text-sm font-medium text-white shadow-xs transition-all hover:shadow-md active:scale-95"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={actions.pause}
            disabled={!isRecording}
            className="rounded-sm border border-ink/20 bg-white/60 px-4 py-2 text-sm font-medium text-ink shadow-xs transition-all hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
          >
            Pause
          </button>
        )}

        {aboveFloor && (
          <button
            type="button"
            onClick={handleStop}
            disabled={disabled}
            className="rounded-sm bg-ember-red px-4 py-2 text-sm font-medium text-white shadow-xs transition-all hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop &amp; transcribe
          </button>
        )}

        <button
          type="button"
          onClick={actions.discard}
          disabled={disabled}
          className="rounded-sm border border-ink/20 bg-transparent px-4 py-2 text-sm font-medium text-ink/70 transition-all hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-night-border dark:text-paper/70 dark:hover:text-paper"
        >
          Discard recording
        </button>
      </div>
    </div>
  )
}
