import React from 'react'
import { act, render, screen } from '@testing-library/react'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import {
  __resetForTesting,
  markSubmitted,
  startMock,
} from '@/lib/recording/session'
import { RemotePresenceProvider } from '@/lib/recording/RemotePresenceContext'
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

  // Phase 4: a passive remote pill when another same-browser tab owns the
  // recording and this tab has no local session.
  test('renders a remote pill when another tab is recording (idle locally)', () => {
    render(
      <RemotePresenceProvider
        value={{
          kind: 'active',
          sessionId: 's1',
          title: 'X',
          state: 'recording',
          startedAt: 0,
          lastResumeAt: 0,
          pausedAccumulatedMs: 0,
        }}
      >
        <RecordingPill />
      </RemotePresenceProvider>
    )
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
    expect(screen.getByTestId('recording-pill-remote')).toHaveTextContent(
      /Recording in another tab/
    )
  })

  test('a local session takes precedence over remote presence', () => {
    act(() => {
      startMock({ title: 'X' })
    })
    render(
      <RemotePresenceProvider value={{ kind: 'lock-only' }}>
        <RecordingPill />
      </RemotePresenceProvider>
    )
    expect(screen.getByTestId('recording-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('recording-pill-remote')).not.toBeInTheDocument()
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
