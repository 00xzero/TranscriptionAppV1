import React from 'react'
import { act, render, screen } from '@testing-library/react'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import {
  __resetForTesting,
  markSubmitted,
  startMock,
} from '@/lib/recording/session'
import { mockRecordingSession } from '../../__mocks__/recording-session'

const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

describe('RecordingPill', () => {
  beforeEach(() => {
    __resetForTesting()
    pushMock.mockReset()
  })

  test('renders nothing when idle', () => {
    render(<RecordingPill />)
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
  })

  test('renders pill with Recording label when state is recording', () => {
    act(() => {
      startMock({ title: 'X' })
    })
    render(<RecordingPill />)
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/Recording/)
    expect(pill).toHaveTextContent(/\d{2}:\d{2}:\d{2}/)
  })

  test('renders Paused label when state is paused', () => {
    act(() => {
      mockRecordingSession({
        state: 'paused',
        title: 'X',
        pausedAccumulatedMs: 65_000,
      })
    })
    render(<RecordingPill />)
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toHaveTextContent(/Paused/)
    expect(pill).toHaveTextContent(/00:01:05/)
  })

  test('disappears when state transitions to submitted', () => {
    act(() => {
      startMock()
    })
    render(<RecordingPill />)
    expect(screen.getByTestId('recording-pill')).toBeInTheDocument()
    act(() => {
      markSubmitted()
    })
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
  })

  test.each(['finalizing', 'uploading'] as const)(
    'does not render in %s state',
    (state) => {
      act(() => {
        mockRecordingSession({ state, title: 'X' })
      })
      render(<RecordingPill />)
      expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
    }
  )
})
