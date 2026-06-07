import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import RecordingDevControls from '@/components/RecordingSession/RecordingDevControls'
import {
  __resetForTesting,
  getSnapshot,
} from '@/lib/recording/session'

describe('RecordingDevControls', () => {
  beforeEach(() => {
    __resetForTesting()
  })

  test('renders dev controls and drives mock recording state in test mode', () => {
    render(<RecordingDevControls />)

    fireEvent.click(screen.getByRole('button', { name: /startMock/i }))

    expect(getSnapshot()).toMatchObject({
      state: 'recording',
      title: 'Demo recording',
    })
  })
})
