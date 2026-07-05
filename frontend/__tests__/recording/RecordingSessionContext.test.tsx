import React from 'react'
import { render, screen } from '@testing-library/react'
import { useRecordingActions } from '@/lib/recording/RecordingSessionContext'

function ActionKeysProbe() {
  const actions = useRecordingActions()
  return (
    <output data-testid="recording-actions">
      {Object.keys(actions).sort().join(',')}
    </output>
  )
}

describe('RecordingSessionContext', () => {
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
})
