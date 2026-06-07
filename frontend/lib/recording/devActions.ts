import {
  forceState,
  markError,
  markInterrupted,
  startMock,
  type RecordingState,
  type StartMockMetadata,
} from './session'
import { RECORDING_DEV_CONTROLS_ENABLED } from './devMode'

export const MOCK_STATES: RecordingState[] = [
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'submitted',
  'discarded',
  'error',
  'interrupted',
]

const PRODUCTION_DEV_ACTION_ERROR =
  'Recording dev actions are unavailable in production.'

function assertDevActionsEnabled(): void {
  if (!RECORDING_DEV_CONTROLS_ENABLED) {
    throw new Error(PRODUCTION_DEV_ACTION_ERROR)
  }
}

export const recordingDevActions = {
  startMock(metadata?: StartMockMetadata): void {
    assertDevActionsEnabled()
    startMock(metadata)
  },
  forceState(state: RecordingState): void {
    assertDevActionsEnabled()
    forceState(state)
  },
  markError(message: string): void {
    assertDevActionsEnabled()
    markError(message)
  },
  markInterrupted(message?: string): void {
    assertDevActionsEnabled()
    markInterrupted(message)
  },
}
