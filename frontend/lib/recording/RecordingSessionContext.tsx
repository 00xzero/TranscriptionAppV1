"use client"

import { useSyncExternalStore } from 'react'
import {
  discard as discardAction,
  finalize as finalizeAction,
  forceState as forceStateAction,
  getServerSnapshot,
  getSnapshot,
  markError as markErrorAction,
  markInterrupted as markInterruptedAction,
  markSubmitted as markSubmittedAction,
  markUploading as markUploadingAction,
  pause as pauseAction,
  recoverInterruptedMock as recoverInterruptedMockAction,
  resetMock as resetMockAction,
  resume as resumeAction,
  startMock as startMockAction,
  stopMock as stopMockAction,
  subscribe,
  type RecordingState,
  type SessionSnapshot,
  type StartMockMetadata,
} from './session'

interface RecordingActions {
  startMock: (metadata?: StartMockMetadata) => void
  pause: () => void
  resume: () => void
  stopMock: () => void
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
  pause: pauseAction,
  resume: resumeAction,
  stopMock: stopMockAction,
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
