"use client"
import {
  useRecordingActions,
  useRecordingState,
} from '@/lib/recording/RecordingSessionContext'

export default function RecordingControls() {
  const state = useRecordingState()
  const actions = useRecordingActions()

  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const disabled = !isRecording && !isPaused

  const handleStop = () => {
    actions.stopMock()
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="recording-controls"
    >
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

      <button
        type="button"
        onClick={handleStop}
        disabled={disabled}
        className="rounded-sm bg-ember-red px-4 py-2 text-sm font-medium text-white shadow-xs transition-all hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Stop &amp; transcribe
      </button>

      <button
        type="button"
        onClick={actions.discard}
        disabled={disabled}
        className="rounded-sm border border-ink/20 bg-transparent px-4 py-2 text-sm font-medium text-ink/70 transition-all hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-night-border dark:text-paper/70 dark:hover:text-paper"
      >
        Discard recording
      </button>
    </div>
  )
}
