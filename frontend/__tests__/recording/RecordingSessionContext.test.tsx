import React from 'react'
import { act, render, screen } from '@testing-library/react'
import {
  RecordingSessionProvider,
  useRecordingActions,
} from '@/lib/recording/RecordingSessionContext'
import { __resetForTesting, __setSnapshotForTesting } from '@/lib/recording/session'
import { mockRecordingSession } from '@/__mocks__/recording-session'
import { resetTestAuth, setTestAuth } from '@/__tests__/helpers/auth'

const toastMock = jest.fn()
let mockPathname = '/transcripts'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)

jest.mock('@/lib/recording/useRemotePresence', () => ({
  useRemotePresence: () => ({ kind: 'none' }),
}))

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

function ActionKeysProbe() {
  const actions = useRecordingActions()
  return (
    <output data-testid="recording-actions">
      {Object.keys(actions).sort().join(',')}
    </output>
  )
}

describe('RecordingSessionContext', () => {
  beforeEach(() => {
    __resetForTesting()
    resetTestAuth()
    toastMock.mockReset()
    mockPathname = '/transcripts'
  })

  test('useRecordingActions exposes only production recording actions', () => {
    render(<ActionKeysProbe />)

    const keys = screen.getByTestId('recording-actions').textContent ?? ''
    expect(keys.split(',')).toEqual([
      'attachAndStart',
      'discard',
      'discardRecovered',
      'pause',
      'resetRecordingSession',
      'resume',
      'retryFinalizedUpload',
      'saveRecovered',
      'stopAndFinalize',
      'updateSessionKeyTerms',
      'updateSessionTitle',
    ])
    expect(keys).not.toContain('startMock')
    expect(keys).not.toContain('forceState')
    expect(keys).not.toContain('markError')
    expect(keys).not.toContain('markInterrupted')
  })

  test('shows each submitted project-missing warning once app-wide', () => {
    render(
      <RecordingSessionProvider>
        <div>Child</div>
      </RecordingSessionProvider>
    )

    act(() => {
      mockRecordingSession({
        state: 'submitted',
        submissionResult: {
          transcriptId: 'transcript-1',
          outcome: 'started',
          warning: 'project_missing',
        },
      })
    })
    act(() => {
      mockRecordingSession({
        state: 'submitted',
        submissionResult: {
          transcriptId: 'transcript-1',
          outcome: 'started',
          warning: 'project_missing',
        },
      })
    })

    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Saved to Unfiled: the project is no longer available',
    })
  })

  test('announces the time limit and automatic stop once per recording off the recording page', () => {
    mockPathname = '/recording/new'
    const { rerender } = render(<RecordingSessionProvider><div>Child</div></RecordingSessionProvider>)

    act(() => {
      __setSnapshotForTesting({ state: 'recording', startedAt: 1000, durationWarning: true })
    })
    expect(toastMock).not.toHaveBeenCalled()

    mockPathname = '/transcripts'
    rerender(<RecordingSessionProvider><div>Child</div></RecordingSessionProvider>)
    act(() => {
      __setSnapshotForTesting({ state: 'paused', startedAt: 1000, durationWarning: true })
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Recording is nearing the time limit',
    }))

    act(() => {
      __setSnapshotForTesting({ state: 'finalizing', startedAt: 1000, autoStopReason: 'duration' })
    })
    act(() => {
      __setSnapshotForTesting({ state: 'uploading', startedAt: 1000, autoStopReason: 'duration' })
    })
    expect(toastMock).toHaveBeenCalledTimes(2)
    expect(toastMock).toHaveBeenLastCalledWith({
      title: 'Recording stopped automatically near the transcription time limit.',
    })
  })

  test('suppresses both recording limit toasts after an account change', () => {
    setTestAuth({ userId: 'original-user', ready: true, accountChange: 'switched' })
    render(<RecordingSessionProvider><div>Child</div></RecordingSessionProvider>)

    act(() => {
      __setSnapshotForTesting({ state: 'recording', startedAt: 1000, durationWarning: true })
    })
    expect(toastMock).not.toHaveBeenCalled()

    act(() => {
      __setSnapshotForTesting({ state: 'finalizing', durationWarning: false, autoStopReason: 'duration' })
    })
    expect(toastMock).not.toHaveBeenCalled()
  })

  test.each([
    ['saved_needs_retry', 'Click Transcribe to retry'],
    ['saved_status_unknown', 'Check the transcript status before retrying'],
  ] as const)('shows the recovered %s notice outside the recording page', (outcome, message) => {
    mockPathname = '/projects'
    render(<RecordingSessionProvider><div>Child</div></RecordingSessionProvider>)
    act(() => {
      __setSnapshotForTesting({
        state: 'submitted',
        submissionResult: { transcriptId: 't1', outcome, recovered: true },
      })
    })
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Recording saved',
      description: expect.stringContaining(message),
    })
  })

  test('keeps the unload guard on during recovered settlement', () => {
    render(<RecordingSessionProvider><div>Child</div></RecordingSessionProvider>)
    act(() => {
      __setSnapshotForTesting({ state: 'recoverable', uploadPhase: 'settling' })
    })
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)

    act(() => {
      __setSnapshotForTesting({ state: 'recoverable', uploadPhase: null })
    })
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  })
})
