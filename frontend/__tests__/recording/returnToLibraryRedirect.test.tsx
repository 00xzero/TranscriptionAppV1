import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import RecordingNewPage from '@/app/recording/new/page'
import { __resetForTesting } from '@/lib/recording/session'
import { mockRecordingSession } from '@/__mocks__/recording-session'

const replaceMock = jest.fn()
const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, back: jest.fn() }),
  usePathname: () => '/recording/new',
}))

// Force the production configuration: with dev controls OFF the missing-session
// redirect is live. The main recording suite runs with dev controls ON, which
// masks this path.
jest.mock('@/lib/recording/devMode', () => ({
  RECORDING_DEV_CONTROLS_ENABLED: false,
}))

describe('Return to library from a retryable upload error (redirect active)', () => {
  beforeEach(() => {
    __resetForTesting()
    replaceMock.mockReset()
    pushMock.mockReset()
  })

  test('navigates to the plain library without tripping the missing-session redirect', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    // Resetting the session flips state to idle; the intentional return must not
    // let that re-trigger the "recording session not found" capture redirect.
    expect(pushMock).toHaveBeenCalledWith('/transcripts')
    expect(replaceMock).not.toHaveBeenCalledWith(
      '/transcripts?capture=recording_session_not_found'
    )
  })
})
