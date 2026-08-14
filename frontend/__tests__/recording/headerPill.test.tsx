import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import RecordingPill from '@/components/RecordingSession/RecordingPill'
import {
  __resetForTesting,
  discard,
  markSubmitted,
  startMock,
} from '@/lib/recording/session'
import { RemotePresenceProvider } from '@/lib/recording/RemotePresenceContext'
import { mockRecordingSession } from '@/__mocks__/recording-session'
import { TooltipProvider } from '@/components/ui/tooltip'

const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

function renderPill(children: React.ReactNode = <RecordingPill />) {
  return render(
    <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
  )
}

describe('RecordingPill', () => {
  beforeEach(() => {
    __resetForTesting()
    pushMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('renders nothing when idle', () => {
    renderPill()
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
  })

  test('renders pill with Recording label when state is recording', () => {
    act(() => {
      startMock({ title: 'X' })
    })
    renderPill()
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/Recording/)
    expect(pill).toHaveTextContent(/\d{2}:\d{2}:\d{2}/)
  })

  test('uses theme-aware design token classes', () => {
    act(() => {
      startMock({ title: 'X' })
    })
    renderPill()
    const pill = screen.getByTestId('recording-pill')

    expect(pill).toHaveClass(
      'border-border',
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
    renderPill()
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toHaveTextContent(/Paused/)
    expect(pill).toHaveTextContent(/00:01:05/)
  })

  test('shows a saved terminal pill briefly after submitted', async () => {
    jest.useFakeTimers()
    act(() => {
      startMock()
    })
    renderPill()
    expect(screen.getByTestId('recording-pill')).toBeInTheDocument()
    act(() => {
      markSubmitted()
    })
    act(() => {
      jest.advanceTimersByTime(0)
    })
    expect(await screen.findByTestId('recording-pill-terminal')).toHaveTextContent(
      /Saved/
    )
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(2_200)
    })
    await waitFor(() => {
      expect(screen.queryByTestId('recording-pill-terminal')).not.toBeInTheDocument()
    })
  })

  test('shows a discarded terminal pill briefly after discard', async () => {
    jest.useFakeTimers()
    act(() => {
      startMock()
    })
    renderPill()
    act(() => {
      discard()
    })
    act(() => {
      jest.advanceTimersByTime(0)
    })

    expect(await screen.findByTestId('recording-pill-terminal')).toHaveTextContent(
      /Discarded/
    )

    act(() => {
      jest.advanceTimersByTime(2_200)
    })
    await waitFor(() => {
      expect(screen.queryByTestId('recording-pill-terminal')).not.toBeInTheDocument()
    })
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
    renderPill()
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(label)
  })

  test('renders a retryable error variant', () => {
    act(() => {
      mockRecordingSession({ state: 'error', title: 'X', canRetryUpload: true })
    })
    renderPill()
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toHaveTextContent(/Recording error/)
    expect(pill).toHaveClass('border-ember-red/50')
  })

  // Phase 4: a passive remote pill when another same-browser tab owns the
  // recording and this tab has no local session.
  test('renders a remote pill when another tab is recording (idle locally)', () => {
    renderPill(
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
    renderPill(
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
    const { unmount } = renderPill()
    const pill = screen.getByTestId('recording-pill')
    expect(pill).toHaveTextContent(/Recording error/)
    expect(pill).toHaveClass('border-ember-red/50')
    unmount()

    // A non-retryable terminal error has nothing to return to.
    act(() => {
      mockRecordingSession({ state: 'error', title: 'X', canRetryUpload: false })
    })
    renderPill()
    expect(screen.queryByTestId('recording-pill')).not.toBeInTheDocument()
  })

  test('tooltip opens on hover with local status details', async () => {
    const user = userEventLib.setup()
    act(() => {
      mockRecordingSession({
        state: 'recording',
        title: 'Weekly review',
        pausedAccumulatedMs: 5_000,
      })
    })
    renderPill()

    await user.hover(screen.getByTestId('recording-pill'))

    expect(await screen.findAllByText('Weekly review')).toHaveLength(1)
    expect(screen.getAllByText(/The recorder is active in this tab/)).toHaveLength(1)
    expect(screen.getAllByText(/Open the recording page/)).toHaveLength(1)
  })

  test('tooltip opens on focus and shows durability warning when not durable', async () => {
    act(() => {
      mockRecordingSession({
        state: 'paused',
        title: 'At-risk recording',
        durable: false,
      })
    })
    renderPill()

    act(() => {
      screen.getByTestId('recording-pill').focus()
    })

    expect(await screen.findAllByText('At-risk recording')).toHaveLength(1)
    expect(
      screen.getAllByText(
        /If this tab refreshes, closes, or crashes, this recording may be lost/
      )
    ).toHaveLength(1)
  })

  test('tooltip omits durability warning while durable', async () => {
    const user = userEventLib.setup()
    act(() => {
      mockRecordingSession({
        state: 'recording',
        title: 'Backed recording',
        durable: true,
      })
    })
    renderPill()

    await user.hover(screen.getByTestId('recording-pill'))

    expect(await screen.findAllByText('Backed recording')).toHaveLength(1)
    expect(
      screen.queryAllByText(
        /If this tab refreshes, closes, or crashes, this recording may be lost/
      )
    ).toHaveLength(0)
  })

  test('remote tooltip explains that controls stay in the owner tab', async () => {
    const user = userEventLib.setup()
    renderPill(
      <RemotePresenceProvider
        value={{
          kind: 'active',
          sessionId: 's1',
          title: 'Remote title',
          state: 'recording',
          startedAt: 0,
          lastResumeAt: 0,
          pausedAccumulatedMs: 0,
        }}
      >
        <RecordingPill />
      </RemotePresenceProvider>
    )

    await user.hover(screen.getByTestId('recording-pill-remote'))

    expect(await screen.findAllByText('Remote title')).toHaveLength(1)
    expect(
      screen.getAllByText(/cannot pause, stop, or save/)
    ).toHaveLength(1)
  })

  test('active and remote pills navigate, but terminal pills do not', async () => {
    const user = userEventLib.setup()
    act(() => {
      startMock({ title: 'X' })
    })
    const { unmount } = renderPill()

    await user.click(screen.getByTestId('recording-pill'))
    expect(pushMock).toHaveBeenCalledWith('/recording/new')
    unmount()

    pushMock.mockReset()
    jest.useFakeTimers()
    act(() => {
      __resetForTesting()
      startMock({ title: 'X' })
    })
    renderPill()
    act(() => {
      markSubmitted()
    })
    act(() => {
      jest.advanceTimersByTime(0)
    })
    const terminal = await screen.findByTestId('recording-pill-terminal')
    expect(terminal.tagName).toBe('DIV')
    expect(pushMock).not.toHaveBeenCalled()
  })
})
