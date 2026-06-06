"use client"

import { useSyncExternalStore } from 'react'
import {
  attachAndStart as attachAndStartAction,
  discard as discardAction,
  forceState as forceStateAction,
  getServerSnapshot,
  getSnapshot,
  markError as markErrorAction,
  markInterrupted as markInterruptedAction,
  pause as pauseAction,
  recoverInterruptedMock as recoverInterruptedMockAction,
  resetMock as resetMockAction,
  restartInterruptedRecording as restartInterruptedRecordingAction,
  retryFinalizedUpload as retryFinalizedUploadAction,
  resume as resumeAction,
  startMock as startMockAction,
  stopAndFinalize as stopAndFinalizeAction,
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
  stopAndFinalize: () => Promise<void>
  restartInterruptedRecording: (maxBytes: number) => Promise<RestartInterruptedResult>
  retryFinalizedUpload: () => Promise<void>
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
  stopAndFinalize: stopAndFinalizeAction,
  restartInterruptedRecording: restartInterruptedRecordingAction,
  retryFinalizedUpload: retryFinalizedUploadAction,
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
