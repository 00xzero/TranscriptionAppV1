import React from 'react'
import { act, render, screen } from '@testing-library/react'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import {
  __resetForTesting,
  markSubmitted,
  startMock,
} from '@/lib/recording/session'
import { mockRecordingSession } from '@/__mocks__/recording-session'

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

  test('uses theme-aware design token classes', () => {
    act(() => {
      startMock({ title: 'X' })
    })
    render(<RecordingPill />)
    const pill = screen.getByTestId('recording-pill')

    expect(pill).toHaveClass(
      'border-base',
      'bg-surface',
      'text-ink',
      'dark:bg-night-surface',
      'dark:text-paper'
    )
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

  // Phase 3: the pill stays reachable for states the user must still resolve after
  // navigating away from /recording/new.
  test.each([
    ['finalizing', /Finalizing/],
    ['uploading', /Uploading/],
    ['recoverable', /Recovered recording/],
  ] as const)('renders in %s state with the expected label', (state, label) => {
    act(() => {
      mockRecordingSession({ state, title: 'X' })
    })
    render(<RecordingPill />)
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(label)
  })

  test('renders a distinct error pill only when the upload can be retried', () => {
    act(() => {
      mockRecordingSession({ state: 'error', title: 'X', canRetryUpload: true })
    })
    const { unmount } = render(<RecordingPill />)
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toHaveTextContent(/Recording error/)
    expect(pill).toHaveClass('border-ember-red/50')
    unmount()

    // A non-retryable terminal error has nothing to return to.
    act(() => {
      mockRecordingSession({ state: 'error', title: 'X', canRetryUpload: false })
    })
    render(<RecordingPill />)
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
  })
})
