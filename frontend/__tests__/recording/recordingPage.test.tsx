import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import RecordingNewPage from '@/app/recording/new/page'
import { shouldRedirectMissingRecordingSession } from '@/lib/recording/recordingRoute'
import {
  __resetForTesting,
  getSnapshot,
  startMock,
} from '@/lib/recording/session'
import { RemotePresenceProvider } from '@/lib/recording/RemotePresenceContext'
import { mockRecordingSession } from '@/__mocks__/recording-session'

const replaceMock = jest.fn()
const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, back: jest.fn() }),
  usePathname: () => '/recording/new',
}))

describe('Recording page', () => {
  beforeEach(() => {
    __resetForTesting()
    replaceMock.mockReset()
    pushMock.mockReset()
  })

  test('idle state renders dev controls when the test flag is enabled', () => {
    render(<RecordingNewPage />)
    expect(screen.getByText(/No active recording/i)).toBeInTheDocument()
    expect(screen.getByTestId('recording-dev-controls')).toBeInTheDocument()
  })

  // Phase 4: a non-owner tab visiting /recording/new sees a passive remote state
  // instead of the idle "no active recording" view (and is not redirected).
  test('remote-active state renders when another tab is recording', () => {
    render(
      <RemotePresenceProvider
        value={{
          kind: 'active',
          sessionId: 's1',
          title: 'Remote rec',
          state: 'recording',
          startedAt: 0,
          lastResumeAt: 0,
          pausedAccumulatedMs: 0,
        }}
      >
        <RecordingNewPage />
      </RemotePresenceProvider>
    )
    expect(screen.getByTestId('recording-remote-active')).toBeInTheDocument()
    expect(screen.getByText('Remote rec')).toBeInTheDocument()
    expect(screen.queryByText(/No active recording/i)).not.toBeInTheDocument()
  })

  test('lock-only remote state renders the generic remote panel', () => {
    render(
      <RemotePresenceProvider value={{ kind: 'lock-only' }}>
        <RecordingNewPage />
      </RemotePresenceProvider>
    )
    expect(screen.getByTestId('recording-remote-active')).toBeInTheDocument()
    expect(screen.getByText(/Recording in another tab/i)).toBeInTheDocument()
  })

  test('production idle redirect waits for the first remote-presence read', () => {
    expect(
      shouldRedirectMissingRecordingSession({
        state: 'idle',
        remoteKind: 'checking',
        devControlsEnabled: false,
      })
    ).toBe(false)
    expect(
      shouldRedirectMissingRecordingSession({
        state: 'idle',
        remoteKind: 'active',
        devControlsEnabled: false,
      })
    ).toBe(false)
    expect(
      shouldRedirectMissingRecordingSession({
        state: 'idle',
        remoteKind: 'none',
        devControlsEnabled: false,
      })
    ).toBe(true)
  })

  test('recording state renders timer, label, waveform, and controls', () => {
    act(() => {
      startMock({ title: 'Standup notes' })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Standup notes')).toBeInTheDocument()
    expect(screen.getByTestId('recording-state-label')).toHaveTextContent(
      'Recording'
    )
    expect(screen.getByTestId('recording-timer')).toBeInTheDocument()
    expect(screen.getByTestId('recording-waveform-mock')).toHaveAttribute(
      'data-state',
      'recording'
    )
    expect(screen.getByTestId('recording-controls')).toBeInTheDocument()
  })

  test('paused state freezes waveform and exposes Resume', () => {
    act(() => {
      mockRecordingSession({
        state: 'paused',
        title: 'Standup notes',
        pausedAccumulatedMs: 12_000,
      })
    })
    render(<RecordingNewPage />)
    expect(screen.getByTestId('recording-waveform-mock')).toHaveAttribute(
      'data-state',
      'paused'
    )
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
    expect(screen.getByTestId('recording-timer')).toHaveTextContent('00:00:12')
  })

  test('finalizing state shows the spinner and hides controls', () => {
    act(() => {
      mockRecordingSession({ state: 'finalizing', title: 't' })
    })
    render(<RecordingNewPage />)
    expect(screen.getByTestId('recording-spinner')).toBeInTheDocument()
    expect(screen.queryByTestId('recording-controls')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('recording-waveform-mock').firstElementChild
    ).toHaveStyle({ animationPlayState: 'paused' })
  })

  test('uploading state keeps the waveform frozen', () => {
    act(() => {
      mockRecordingSession({ state: 'uploading', title: 't' })
    })
    render(<RecordingNewPage />)
    expect(
      screen.getByTestId('recording-waveform-mock').firstElementChild
    ).toHaveStyle({ animationPlayState: 'paused' })
  })

  // Phase 3: the beforeunload guard moved to RecordingSessionProvider (app-level),
  // so the page itself no longer installs it. Covered in beforeUnloadGuard.test.tsx.
  test('page does not install its own beforeunload listener', () => {
    act(() => {
      mockRecordingSession({ state: 'recording', title: 't' })
    })
    const addSpy = jest.spyOn(window, 'addEventListener')

    render(<RecordingNewPage />)

    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
  })

  test.each(['recording', 'paused', 'finalizing', 'uploading'] as const)(
    'shows the durability warning in %s state when not durable',
    (state) => {
      act(() => {
        mockRecordingSession({ state, title: 't', durable: false })
      })
      render(<RecordingNewPage />)
      expect(screen.getByTestId('durability-warning')).toBeInTheDocument()
    }
  )

  test('hides the durability warning while durable', () => {
    act(() => {
      mockRecordingSession({ state: 'recording', title: 't', durable: true })
    })
    render(<RecordingNewPage />)
    expect(screen.queryByTestId('durability-warning')).not.toBeInTheDocument()
  })

  test('shows the capture-health warning when one is present', () => {
    act(() => {
      mockRecordingSession({
        state: 'recording',
        title: 't',
        captureHealthWarning: 'No audio recently',
      })
    })
    render(<RecordingNewPage />)
    expect(screen.getByTestId('capture-health-warning')).toHaveTextContent(
      'No audio recently'
    )
  })

  test('error state shows the message and Return to library CTA', () => {
    act(() => {
      mockRecordingSession({
        state: 'error',
        title: 't',
        errorMessage: 'Mic unplugged',
      })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Mic unplugged')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /return to library/i })
    ).toBeInTheDocument()
  })

  test('discard button discards without rendering the click event as a banner', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      act(() => {
        startMock({ title: 'Discard me' })
      })
      render(<RecordingNewPage />)

      fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringMatching(/discard this recording/i)
      )
      expect(getSnapshot().state).toBe('discarded')
      expect(getSnapshot().salvageMessage).toBeNull()
      expect(screen.getByText(/Returning to library/i)).toBeInTheDocument()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  test('canceling the discard confirmation keeps the recording active', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      act(() => {
        startMock({ title: 'Keep me' })
      })
      render(<RecordingNewPage />)

      fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))

      expect(confirmSpy).toHaveBeenCalled()
      expect(getSnapshot().state).toBe('recording')
      expect(screen.getByText('Keep me')).toBeInTheDocument()
      expect(screen.getByTestId('recording-controls')).toBeInTheDocument()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  test('returning from a retryable upload error requires discard confirmation', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      act(() => {
        mockRecordingSession({
          state: 'error',
          title: 't',
          errorMessage: 'Upload failed',
          canRetryUpload: true,
        })
      })
      render(<RecordingNewPage />)

      fireEvent.click(screen.getByRole('button', { name: /return to library/i }))

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringMatching(/discard your recording/i)
      )
      expect(pushMock).not.toHaveBeenCalled()
      expect(getSnapshot().state).toBe('error')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  test('confirming discard on a retryable upload error returns to library', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      act(() => {
        mockRecordingSession({
          state: 'error',
          title: 't',
          errorMessage: 'Upload failed',
          canRetryUpload: true,
        })
      })
      render(<RecordingNewPage />)

      fireEvent.click(screen.getByRole('button', { name: /return to library/i }))

      expect(confirmSpy).toHaveBeenCalled()
      expect(getSnapshot().state).toBe('idle')
      expect(pushMock).toHaveBeenCalledWith('/projects')
    } finally {
      confirmSpy.mockRestore()
    }
  })

  test('interrupted state shows the unrecoverable copy and Return to library CTA', () => {
    act(() => {
      mockRecordingSession({ state: 'interrupted', title: 'Lost one' })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Lost one')).toBeInTheDocument()
    expect(
      screen.getByText(/Your recording was interrupted/i)
    ).toBeInTheDocument()
    // The old "Start a new recording" restart CTA is gone; sealed recovery is
    // offered by the global modal instead.
    expect(
      screen.queryByRole('button', { name: /start a new recording/i })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /return to library/i })
    ).toBeInTheDocument()
  })

  test('recoverable state shows the recovering status', () => {
    act(() => {
      mockRecordingSession({ state: 'recoverable', title: 'Recovered one' })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Recovered one')).toBeInTheDocument()
    expect(
      screen.getByText(/Recovering a previous recording/i)
    ).toBeInTheDocument()
  })

  test('submitted state schedules navigation to /projects', () => {
    jest.useFakeTimers()
    try {
      act(() => {
        mockRecordingSession({ state: 'submitted', title: 't' })
      })
      render(<RecordingNewPage />)
      expect(
        screen.getByRole('link', { name: /return to library/i })
      ).toHaveAttribute('href', '/projects')
      act(() => {
        jest.advanceTimersByTime(700)
      })
      expect(replaceMock).toHaveBeenCalledWith('/projects')
    } finally {
      jest.useRealTimers()
    }
  })

  test('terminal navigation retries if the first replace does not leave the page', () => {
    jest.useFakeTimers()
    try {
      act(() => {
        mockRecordingSession({ state: 'discarded', title: 't' })
      })
      render(<RecordingNewPage />)

      act(() => {
        jest.advanceTimersByTime(1_600)
      })

      expect(replaceMock).toHaveBeenCalledTimes(2)
      expect(replaceMock).toHaveBeenNthCalledWith(1, '/projects')
      expect(replaceMock).toHaveBeenNthCalledWith(2, '/projects')
    } finally {
      jest.useRealTimers()
    }
  })

  test('stop without a live controller shows interrupted recovery state', async () => {
    act(() => {
      mockRecordingSession({
        state: 'recording',
        title: 't',
        pausedAccumulatedMs: 3000,
        bytesSoFar: 8192,
      })
    })
    render(<RecordingNewPage />)

    fireEvent.click(screen.getByRole('button', { name: /stop & transcribe/i }))

    expect(
      await screen.findByText(/Your recording was interrupted/i)
    ).toBeInTheDocument()
    expect(getSnapshot()).toMatchObject({
      state: 'interrupted',
      errorMessage: 'Recording session was lost before it could be saved.',
    })
  })
})
