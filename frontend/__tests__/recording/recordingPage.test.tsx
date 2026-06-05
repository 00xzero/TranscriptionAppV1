import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import RecordingNewPage from '@/app/recording/new/page'
import {
  __resetForTesting,
  getSnapshot,
  startMock,
} from '@/lib/recording/session'
import { mockRecordingSession } from '../../__mocks__/recording-session'

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

  test('idle state renders dev controls (in jsdom NODE_ENV=test)', () => {
    render(<RecordingNewPage />)
    expect(screen.getByText(/No active recording/i)).toBeInTheDocument()
    expect(screen.getByTestId('recording-dev-controls')).toBeInTheDocument()
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

  test.each(['finalizing', 'uploading'] as const)(
    '%s state keeps the beforeunload guard active',
    (state) => {
      act(() => {
        mockRecordingSession({ state, title: 't' })
      })
      const addSpy = jest.spyOn(window, 'addEventListener')

      render(<RecordingNewPage />)

      expect(addSpy).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      )
    }
  )

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

  test('interrupted state shows recovery copy and Start a new recording CTA', () => {
    act(() => {
      mockRecordingSession({ state: 'interrupted', title: 'Lost one' })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Lost one')).toBeInTheDocument()
    expect(
      screen.getByText(/Your recording was interrupted/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /start a new recording/i })
    ).toBeInTheDocument()
  })

  test('idle page restores an interrupted draft from sessionStorage', async () => {
    window.sessionStorage.setItem(
      'recording.sessionDraft',
      JSON.stringify({ title: 'Recovered title' })
    )

    render(<RecordingNewPage />)

    expect(
      await screen.findByText(/Your recording was interrupted/i)
    ).toBeInTheDocument()
    expect(screen.getByText('Recovered title')).toBeInTheDocument()
  })

  test('interrupted CTA surfaces a recovery error when the browser cannot record', async () => {
    act(() => {
      mockRecordingSession({ state: 'interrupted', title: 'Lost one' })
    })
    render(<RecordingNewPage />)

    fireEvent.click(screen.getByRole('button', { name: /start a new recording/i }))

    // jsdom lacks navigator.mediaDevices.getUserMedia, so the real restart
    // path surfaces an inline error and the session stays in `interrupted`
    // (no Capture round-trip per spec).
    await screen.findByRole('alert')
    expect(getSnapshot().state).toBe('interrupted')
    expect(screen.getByText('Lost one')).toBeInTheDocument()
  })

  test('submitted state schedules navigation to /projects', () => {
    jest.useFakeTimers()
    try {
      act(() => {
        mockRecordingSession({ state: 'submitted', title: 't' })
      })
      render(<RecordingNewPage />)
      act(() => {
        jest.advanceTimersByTime(700)
      })
      expect(replaceMock).toHaveBeenCalledWith('/projects')
    } finally {
      jest.useRealTimers()
    }
  })

  test('mock stop timers cannot mutate a later reset session', () => {
    jest.useFakeTimers()
    try {
      act(() => {
        // Seed past the empty-floor gate so `Stop & transcribe` is visible.
        mockRecordingSession({
          state: 'recording',
          title: 't',
          pausedAccumulatedMs: 3000,
          bytesSoFar: 8192,
        })
      })
      const { unmount } = render(<RecordingNewPage />)

      fireEvent.click(screen.getByRole('button', { name: /stop & transcribe/i }))
      unmount()

      act(() => {
        __resetForTesting()
        jest.advanceTimersByTime(2000)
      })

      expect(getSnapshot().state).toBe('idle')
    } finally {
      jest.useRealTimers()
    }
  })

  test('stop completes the mocked lifecycle after controls unmount', () => {
    jest.useFakeTimers()
    try {
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
      expect(screen.getByTestId('recording-spinner')).toBeInTheDocument()

      act(() => {
        jest.advanceTimersByTime(800)
      })
      expect(getSnapshot().state).toBe('uploading')

      act(() => {
        jest.advanceTimersByTime(1000)
      })
      expect(getSnapshot().state).toBe('submitted')
    } finally {
      jest.useRealTimers()
    }
  })
})
