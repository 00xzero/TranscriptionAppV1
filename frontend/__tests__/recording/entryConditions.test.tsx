import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecordingNewPage from '@/app/recording/new/page'
import {
  __resetForTesting,
  attachAndStart,
  getSnapshot,
} from '@/lib/recording/session'
import { mockRecordingSession } from '../../__mocks__/recording-session'
import {
  createFakeStream,
  installMediaRecorderMock,
} from '../../__mocks__/MediaRecorder'
import {
  installGetUserMediaMock,
  resetGetUserMediaMock,
} from '../../__mocks__/getUserMedia'

const replaceMock = jest.fn()
const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, back: jest.fn() }),
  usePathname: () => '/recording/new',
}))

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

// NOTE: the direct-URL-visit redirect (`/projects?capture=recording_session_not_found`)
// is gated on `process.env.NODE_ENV === 'production'`; under Jest (NODE_ENV=test)
// the page shows the dev controls instead, so that branch is covered by manual QA.

describe('recording page entry conditions', () => {
  beforeEach(() => {
    __resetForTesting()
    replaceMock.mockReset()
    pushMock.mockReset()
    installMediaRecorderMock()
  })

  afterEach(() => {
    resetGetUserMediaMock()
  })

  test('fresh handoff renders the in-progress recording', () => {
    act(() => {
      attachAndStart({
        stream: createFakeStream(),
        codec: CODEC,
        title: 'Live session',
        keyTerms: [],
        deviceId: null,
        maxBytes: 1024 * 1024,
      })
    })
    render(<RecordingNewPage />)
    expect(screen.getByText('Live session')).toBeInTheDocument()
    expect(screen.getByTestId('recording-state-label')).toHaveTextContent(
      'Recording'
    )
    expect(screen.getByTestId('recording-controls')).toBeInTheDocument()
  })

  test('refresh during recording restores the interrupted draft', async () => {
    window.sessionStorage.setItem(
      'recording.sessionDraft',
      JSON.stringify({ title: 'Recovered', keyTerms: [] })
    )
    render(<RecordingNewPage />)
    expect(
      await screen.findByText(/Your recording was interrupted/i)
    ).toBeInTheDocument()
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

  test('interrupted -> Start a new recording begins a fresh session', async () => {
    installGetUserMediaMock() // resolves a fake mic stream
    act(() => {
      mockRecordingSession({ state: 'interrupted', title: 'Lost one' })
    })
    render(<RecordingNewPage />)

    fireEvent.click(
      screen.getByRole('button', { name: /start a new recording/i })
    )

    await waitFor(() => expect(getSnapshot().state).toBe('recording'))
    expect(getSnapshot().title).toBe('Lost one')
  })
})
