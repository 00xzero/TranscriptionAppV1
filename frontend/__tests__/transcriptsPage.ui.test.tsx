import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import TranscriptsPage from '@/app/transcripts/page'
import type { Transcript } from '@/contracts/db'
import { TooltipProvider } from '@/components/ui/tooltip'

const mockDeleteTranscript = jest.fn()
const mockRefetch = jest.fn()
const mockReplace = jest.fn()
const mockOpenCaptureModal = jest.fn()
const mockUseTranscriptsRealtime = jest.fn()

const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  title: 'Transcript Alpha',
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: 245,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: '2026-04-01T12:00:00Z',
  updated_at: '2026-04-01T13:00:00Z',
  ...overrides,
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => {
  function MockNextLink({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }

  MockNextLink.displayName = 'MockNextLink'
  return MockNextLink
})

jest.mock('@/lib/ModalContext', () => ({
  useModal: () => ({
    openCaptureModal: mockOpenCaptureModal,
  }),
}))

jest.mock('@/lib/supabase/hooks', () => ({
  useTranscriptsRealtime: () => mockUseTranscriptsRealtime(),
}))

describe('TranscriptsPage', () => {
  const renderTranscriptsPage = () =>
    render(
      <TooltipProvider delayDuration={0}>
        <TranscriptsPage />
      </TooltipProvider>
    )

  beforeEach(() => {
    jest.clearAllMocks()
    mockDeleteTranscript.mockResolvedValue(undefined)
    mockUseTranscriptsRealtime.mockReturnValue({
      transcripts: [makeTranscript()],
      isLoading: false,
      connectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetch: mockRefetch,
    })
  })

  test('deletes a transcript after alert dialog confirmation', async () => {
    const user = userEventLib.setup()
    renderTranscriptsPage()

    await screen.findByText('Transcript Alpha')
    await user.click(
      screen.getByRole('button', { name: /Delete transcript Transcript Alpha/i })
    )

    expect(await screen.findByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will permanently remove the transcript and all associated data. This action cannot be undone.'
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockDeleteTranscript).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    })
  })

  test('does not delete a transcript when alert dialog is canceled', async () => {
    const user = userEventLib.setup()
    renderTranscriptsPage()

    await screen.findByText('Transcript Alpha')
    await user.click(
      screen.getByRole('button', { name: /Delete transcript Transcript Alpha/i })
    )

    expect(await screen.findByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will permanently remove the transcript and all associated data. This action cannot be undone.'
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeleteTranscript).not.toHaveBeenCalled()
  })
})
