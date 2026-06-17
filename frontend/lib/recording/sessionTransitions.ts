import type { RecordingState, SessionSnapshot } from './sessionTypes'

export type RecordingTransitionAction =
  | 'pause'
  | 'resume'
  | 'finalize'
  | 'markUploading'
  | 'markSubmitted'
  | 'discard'
  | 'markError'
  | 'markInterrupted'
  | 'handleRecorderFailure'

export type SnapshotTransitionAction = Exclude<
  RecordingTransitionAction,
  'handleRecorderFailure'
>

export interface TransitionSpec {
  target: RecordingState
  foldsElapsedTime: boolean
}

export const TRANSITION_SPECS: Record<SnapshotTransitionAction, TransitionSpec> = {
  pause: { target: 'paused', foldsElapsedTime: true },
  resume: { target: 'recording', foldsElapsedTime: false },
  finalize: { target: 'finalizing', foldsElapsedTime: true },
  markUploading: { target: 'uploading', foldsElapsedTime: false },
  markSubmitted: { target: 'submitted', foldsElapsedTime: false },
  discard: { target: 'discarded', foldsElapsedTime: false },
  markError: { target: 'error', foldsElapsedTime: true },
  markInterrupted: { target: 'interrupted', foldsElapsedTime: false },
}

const IN_FLIGHT_STATES: ReadonlySet<RecordingState> = new Set([
  'recording',
  'paused',
  'finalizing',
  'uploading',
])

const TERMINAL_STATES: ReadonlySet<RecordingState> = new Set([
  'submitted',
  'discarded',
  'error',
  'interrupted',
])

const ACTIVE_RECORDING_STATES: ReadonlySet<RecordingState> = new Set([
  'recording',
  'paused',
])

const ERRORABLE_STATES: ReadonlySet<RecordingState> = new Set([
  'idle',
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'error',
])

const DISCARDABLE_STATES: ReadonlySet<RecordingState> = new Set([
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'error',
  'interrupted',
])

const INTERRUPTIBLE_STATES: ReadonlySet<RecordingState> = new Set([
  'idle',
  'recording',
  'paused',
  'finalizing',
  'uploading',
  'error',
  'interrupted',
])

function assertNever(value: never): never {
  throw new Error(`Unhandled recording transition action: ${String(value)}`)
}

export function isTerminalState(state: RecordingState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isInFlightState(state: RecordingState): boolean {
  return IN_FLIGHT_STATES.has(state)
}

export function isRetryableError(snapshot: SessionSnapshot): boolean {
  return snapshot.state === 'error' && snapshot.canRetryUpload
}

export function shouldIgnoreRecorderFailure(state: RecordingState): boolean {
  return !canTransition(state, 'handleRecorderFailure')
}

export function canTransition(
  fromState: RecordingState,
  action: RecordingTransitionAction
): boolean {
  switch (action) {
    case 'pause':
      return fromState === 'recording'
    case 'resume':
      return fromState === 'paused'
    case 'finalize':
      return ACTIVE_RECORDING_STATES.has(fromState)
    case 'markUploading':
      return (
        fromState === 'finalizing' ||
        fromState === 'uploading' ||
        fromState === 'error'
      )
    case 'markSubmitted':
      return (
        fromState === 'recording' ||
        fromState === 'paused' ||
        fromState === 'finalizing' ||
        fromState === 'uploading' ||
        fromState === 'submitted' ||
        // Recovery save transitions straight from the recoverable state.
        fromState === 'recoverable'
      )
    case 'discard':
      return DISCARDABLE_STATES.has(fromState)
    case 'markError':
      return ERRORABLE_STATES.has(fromState)
    case 'markInterrupted':
      return INTERRUPTIBLE_STATES.has(fromState)
    case 'handleRecorderFailure':
      return ACTIVE_RECORDING_STATES.has(fromState)
    default:
      return assertNever(action)
  }
}
