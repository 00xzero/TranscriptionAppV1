import {
  TRANSITION_SPECS,
  canTransition,
  isInFlightState,
  isRetryableError,
  isTerminalState,
  shouldIgnoreRecorderFailure,
  type SnapshotTransitionAction,
} from '@/lib/recording/sessionTransitions'
import {
  IDLE_SNAPSHOT,
  type RecordingState,
  type SessionSnapshot,
} from '@/lib/recording/session'

function snapshot(
  partial: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    ...IDLE_SNAPSHOT,
    ...partial,
  }
}

describe('recording session transitions', () => {
  test('snapshot transition specs structurally map actions to target states', () => {
    const expectedTargets: Record<SnapshotTransitionAction, RecordingState> = {
      pause: 'paused',
      resume: 'recording',
      finalize: 'finalizing',
      markUploading: 'uploading',
      markSubmitted: 'submitted',
      discard: 'discarded',
      markError: 'error',
      markInterrupted: 'interrupted',
    }

    expect(Object.keys(TRANSITION_SPECS).sort()).toEqual(
      Object.keys(expectedTargets).sort()
    )

    Object.entries(expectedTargets).forEach(([action, target]) => {
      expect(TRANSITION_SPECS[action as SnapshotTransitionAction].target).toBe(
        target
      )
    })
  })

  test('snapshot transition specs fold elapsed time only where expected', () => {
    const elapsedFoldActions: SnapshotTransitionAction[] = [
      'pause',
      'finalize',
      'markError',
    ]

    Object.entries(TRANSITION_SPECS).forEach(([action, spec]) => {
      expect(spec.foldsElapsedTime).toBe(
        elapsedFoldActions.includes(action as SnapshotTransitionAction)
      )
    })
  })

  test('recording -> pause is allowed; non-recording pause is ignored', () => {
    expect(canTransition('recording', 'pause')).toBe(true)
    expect(canTransition('idle', 'pause')).toBe(false)
    expect(canTransition('paused', 'pause')).toBe(false)
    expect(canTransition('finalizing', 'pause')).toBe(false)
  })

  test('paused -> resume is allowed; non-paused resume is ignored', () => {
    expect(canTransition('paused', 'resume')).toBe(true)
    expect(canTransition('idle', 'resume')).toBe(false)
    expect(canTransition('recording', 'resume')).toBe(false)
    expect(canTransition('uploading', 'resume')).toBe(false)
  })

  test('recording and paused can finalize', () => {
    expect(canTransition('recording', 'finalize')).toBe(true)
    expect(canTransition('paused', 'finalize')).toBe(true)
    expect(canTransition('idle', 'finalize')).toBe(false)
    expect(canTransition('uploading', 'finalize')).toBe(false)
  })

  test('finalizing -> markUploading -> markSubmitted is explicit', () => {
    expect(canTransition('finalizing', 'markUploading')).toBe(true)
    expect(canTransition('uploading', 'markSubmitted')).toBe(true)
    expect(canTransition('recording', 'markSubmitted')).toBe(true)
    expect(canTransition('idle', 'markSubmitted')).toBe(false)
    // Recovery save transitions straight from the recoverable state.
    expect(canTransition('recoverable', 'markSubmitted')).toBe(true)
  })

  test('terminal states do not accept recorder failure handling', () => {
    const terminalStates: RecordingState[] = [
      'submitted',
      'discarded',
      'error',
      'interrupted',
    ]

    terminalStates.forEach((state) => {
      expect(isTerminalState(state)).toBe(true)
      expect(canTransition(state, 'handleRecorderFailure')).toBe(false)
      expect(shouldIgnoreRecorderFailure(state)).toBe(true)
    })
  })

  test('recorder failures are only handled while actively recording or paused', () => {
    expect(canTransition('recording', 'handleRecorderFailure')).toBe(true)
    expect(canTransition('paused', 'handleRecorderFailure')).toBe(true)
    expect(shouldIgnoreRecorderFailure('finalizing')).toBe(true)
    expect(shouldIgnoreRecorderFailure('uploading')).toBe(true)
    expect(shouldIgnoreRecorderFailure('idle')).toBe(true)
  })

  test('retryable upload errors count as active; non-retryable errors do not', () => {
    expect(isInFlightState('recording')).toBe(true)
    expect(isInFlightState('paused')).toBe(true)
    expect(isInFlightState('finalizing')).toBe(true)
    expect(isInFlightState('uploading')).toBe(true)
    expect(isInFlightState('error')).toBe(false)

    expect(
      isRetryableError(snapshot({ state: 'error', canRetryUpload: true }))
    ).toBe(true)
    expect(
      isRetryableError(snapshot({ state: 'error', canRetryUpload: false }))
    ).toBe(false)
    expect(
      isRetryableError(snapshot({ state: 'recording', canRetryUpload: true }))
    ).toBe(false)
  })
})
