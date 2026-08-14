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
import { Button } from '@/components/ui/button'

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
            <Button
              type="button"
              variant="primary"
              onClick={actions.resume}
              aria-label="Resume"
              title="Resume"
              className="hover:shadow-md"
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
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={actions.pause}
              disabled={!isRecording}
              aria-label="Pause"
              title="Pause"
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
            </Button>
          )}

          {aboveFloor && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleStop}
              disabled={disabled}
              className="hover:shadow-md"
            >
              Stop &amp; transcribe
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={() => setDiscardConfirmOpen(true)}
            disabled={disabled}
            className="border border-border"
          >
            Discard
          </Button>
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
