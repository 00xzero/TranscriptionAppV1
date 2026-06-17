import React from 'react'
import { act, render, screen } from '@testing-library/react'
import RecordingNewPage from '@/app/recording/new/page'
import {
  __resetForTesting,
  attachAndStart,
  forceState,
} from '@/lib/recording/session'
import {
  createFakeStream,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'

const replaceMock = jest.fn()
const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, back: jest.fn() }),
  usePathname: () => '/recording/new',
}))

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

// NOTE: the direct-URL-visit redirect (`/projects?capture=recording_session_not_found`)
// is gated off when NEXT_PUBLIC_RECORDING_DEV_CONTROLS is enabled for tests,
// so that branch is covered by manual QA.

describe('recording page entry conditions', () => {
  beforeEach(() => {
    __resetForTesting()
    replaceMock.mockReset()
    pushMock.mockReset()
    installMediaRecorderMock()
    setIdentity({ userId: 'user-123', ready: true })
  })

  test('fresh handoff renders the in-progress recording', async () => {
    await act(async () => {
      await attachAndStart({
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

  test('recoverable state renders the recovering status (modal is global)', () => {
    act(() => {
      forceState('recoverable')
    })
    render(<RecordingNewPage />)
    expect(screen.getByText(/Recovering a previous recording/i)).toBeInTheDocument()
    // The recovery modal itself is mounted by RecordingSessionProvider, not the
    // route, so it is not asserted here.
  })
})
