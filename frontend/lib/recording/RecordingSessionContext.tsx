"use client"

import { useSyncExternalStore } from 'react'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  getServerSnapshot,
  getSnapshot,
  pause as pauseAction,
  recoverInterruptedDraft as recoverInterruptedDraftAction,
  resetRecordingSession as resetRecordingSessionAction,
  restartInterruptedRecording as restartInterruptedRecordingAction,
  retryFinalizedUpload as retryFinalizedUploadAction,
  resume as resumeAction,
  stopAndFinalize as stopAndFinalizeAction,
  subscribe,
  type AttachAndStartParams,
  type RecordingState,
  type RestartInterruptedResult,
  type SessionSnapshot,
} from './session'
export { RecordingAlreadyActiveError } from './session'

interface RecordingActions {
  attachAndStart: (params: AttachAndStartParams) => void
  pause: () => void
  resume: () => void
  stopAndFinalize: () => Promise<void>
  restartInterruptedRecording: (maxBytes: number) => Promise<RestartInterruptedResult>
  retryFinalizedUpload: () => Promise<void>
  discard: () => void
  resetRecordingSession: () => void
  recoverInterruptedDraft: () => boolean
}

const actions: RecordingActions = {
  attachAndStart: attachAndStartAction,
  pause: pauseAction,
  resume: resumeAction,
  stopAndFinalize: stopAndFinalizeAction,
  restartInterruptedRecording: restartInterruptedRecordingAction,
  retryFinalizedUpload: retryFinalizedUploadAction,
  discard: discardAction,
  resetRecordingSession: resetRecordingSessionAction,
  recoverInterruptedDraft: recoverInterruptedDraftAction,
}

export function RecordingSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

export function useRecordingSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useRecordingState(): RecordingState {
  return useRecordingSession().state
}

export function useRecordingActions(): RecordingActions {
  return actions
}
