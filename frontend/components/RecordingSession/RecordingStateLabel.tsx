"use client"

import { useRecordingState } from '@/lib/recording/RecordingSessionContext'
import type { RecordingState } from '@/lib/recording/session'

const LABEL: Record<RecordingState, string> = {
  idle: 'Ready',
  recording: 'Recording',
  paused: 'Paused',
  finalizing: 'Saving recording',
  uploading: 'Uploading',
  submitted: 'Submitted',
  discarded: 'Discarded',
  error: 'Recording error',
  interrupted: 'Recording interrupted',
}

interface RecordingStateLabelProps {
  className?: string
}

export default function RecordingStateLabel({
  className,
}: RecordingStateLabelProps) {
  const state = useRecordingState()
  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      data-testid="recording-state-label"
    >
      {LABEL[state]}
    </div>
  )
}
