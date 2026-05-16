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
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
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

  test('interrupted CTA starts a new mock recording with the preserved title', () => {
    act(() => {
      mockRecordingSession({ state: 'interrupted', title: 'Lost one' })
    })
    render(<RecordingNewPage />)

    fireEvent.click(screen.getByRole('button', { name: /start a new recording/i }))

    expect(getSnapshot()).toMatchObject({
      state: 'recording',
      title: 'Lost one',
    })
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
        startMock({ title: 't' })
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

  test('stop mock completes the mocked lifecycle after controls unmount', () => {
    jest.useFakeTimers()
    try {
      act(() => {
        startMock({ title: 't' })
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
