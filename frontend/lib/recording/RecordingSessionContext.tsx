"use client"

import { useSyncExternalStore } from 'react'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  finalize as finalizeAction,
  forceState as forceStateAction,
  getServerSnapshot,
  getSnapshot,
  handleRecorderFailure as handleRecorderFailureAction,
  hasUnsavedRecording as hasUnsavedRecordingFn,
  markError as markErrorAction,
  markInterrupted as markInterruptedAction,
  markSubmitted as markSubmittedAction,
  markUploading as markUploadingAction,
  pause as pauseAction,
  recordChunk as recordChunkAction,
  recoverInterruptedMock as recoverInterruptedMockAction,
  resetMock as resetMockAction,
  restartInterruptedRecording as restartInterruptedRecordingAction,
  retryFinalizedUpload as retryFinalizedUploadAction,
  resume as resumeAction,
  startMock as startMockAction,
  stopAndFinalize as stopAndFinalizeAction,
  stopMock as stopMockAction,
  subscribe,
  type AttachAndStartParams,
  type RecordingState,
  type RestartInterruptedResult,
  type SessionSnapshot,
  type StartMockMetadata,
} from './session'
export { RecordingAlreadyActiveError } from './session'

interface RecordingActions {
  startMock: (metadata?: StartMockMetadata) => void
  attachAndStart: (params: AttachAndStartParams) => void
  pause: () => void
  resume: () => void
  stopMock: () => void
  stopAndFinalize: () => Promise<void>
  recordChunk: (blob: Blob) => void
  handleRecorderFailure: (reason: string) => void
  restartInterruptedRecording: (maxBytes: number) => Promise<RestartInterruptedResult>
  retryFinalizedUpload: () => Promise<void>
  hasUnsavedRecording: () => boolean
  finalize: () => void
  markUploading: () => void
  markSubmitted: () => void
  discard: () => void
  markError: (message: string) => void
  markInterrupted: (message?: string) => void
  resetMock: () => void
  recoverInterruptedMock: () => boolean
  forceState: (state: RecordingState) => void
}

const actions: RecordingActions = {
  startMock: startMockAction,
  attachAndStart: attachAndStartAction,
  pause: pauseAction,
  resume: resumeAction,
  stopMock: stopMockAction,
  stopAndFinalize: stopAndFinalizeAction,
  recordChunk: recordChunkAction,
  handleRecorderFailure: handleRecorderFailureAction,
  restartInterruptedRecording: restartInterruptedRecordingAction,
  retryFinalizedUpload: retryFinalizedUploadAction,
  hasUnsavedRecording: hasUnsavedRecordingFn,
  finalize: finalizeAction,
  markUploading: markUploadingAction,
  markSubmitted: markSubmittedAction,
  discard: discardAction,
  markError: markErrorAction,
  markInterrupted: markInterruptedAction,
  resetMock: resetMockAction,
  recoverInterruptedMock: recoverInterruptedMockAction,
  forceState: forceStateAction,
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
