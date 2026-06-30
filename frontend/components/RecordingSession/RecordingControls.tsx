"use client"
import { useState } from 'react'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import {
  getElapsedActiveMs,
} from '@/lib/recording/session'
import { meetsEmptyFloor } from '@/lib/recording/sizeBudget'
import { DiscardRecordingDialog } from '@/components/DiscardRecordingDialog'

export default function RecordingControls() {
  const snapshot = useRecordingSession()
  const actions = useRecordingActions()
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

  const state = snapshot.state
  const isRecording = state === 'recording'
  const isPaused = state === 'paused'
  const canControl = isRecording || isPaused
  const disabled = !canControl

  const activeMs = getElapsedActiveMs(snapshot)
  const aboveFloor = meetsEmptyFloor(activeMs, snapshot.bytesSoFar)

  const handleStop = () => {
    void actions.stopAndFinalize()
  }

  const handleDiscard = () => {
    actions.discard()
  }

  return (
    <>
      <div className="flex flex-col gap-3" data-testid="recording-controls">
        {!aboveFloor && canControl && (
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
              aria-label="Resume"
              title="Resume"
              className="inline-flex items-center justify-center rounded-sm bg-trust-blue px-4 py-2 text-sm font-medium text-white shadow-xs transition-all hover:shadow-md active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={actions.pause}
              disabled={!isRecording}
              aria-label="Pause"
              title="Pause"
              className="inline-flex items-center justify-center rounded-sm border border-ink/20 bg-white/60 px-4 py-2 text-sm font-medium text-ink shadow-xs transition-all hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="7" y="5" width="3.5" height="14" rx="1.25" />
                <rect x="13.5" y="5" width="3.5" height="14" rx="1.25" />
              </svg>
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
            onClick={() => setDiscardConfirmOpen(true)}
            disabled={disabled}
            className="rounded-sm border border-ink/20 bg-transparent px-4 py-2 text-sm font-medium text-ink/70 transition-all hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-night-border dark:text-paper/70 dark:hover:text-paper"
          >
            Discard
          </button>
        </div>
      </div>
      <DiscardRecordingDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        onConfirm={handleDiscard}
      />
    </>
  )
}
