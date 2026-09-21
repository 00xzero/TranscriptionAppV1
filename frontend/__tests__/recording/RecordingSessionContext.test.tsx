import React from 'react'
import { act, render, screen } from '@testing-library/react'
import {
  RecordingSessionProvider,
  useRecordingActions,
} from '@/lib/recording/RecordingSessionContext'
import { __resetForTesting } from '@/lib/recording/session'
import { mockRecordingSession } from '@/__mocks__/recording-session'

const toastMock = jest.fn()

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
    toastMock.mockReset()
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
})
