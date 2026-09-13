import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import LibraryView from '../components/LibraryView'
import type { Transcript } from '../contracts/db'
import { TooltipProvider } from '../components/ui/tooltip'
import { TRANSCRIPT_CLEANUP_PENDING_TOAST } from '@/lib/transcripts/deleteErrors'

const mockGetUser = jest.fn()
const mockDeleteTranscript = jest.fn()
const mockUseTranscriptsRealtime = jest.fn()
const mockToast = jest.fn()

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  project_id: null,
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

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

jest.mock('@/lib/supabase/hooks', () => ({
  useTranscriptsRealtime: () => mockUseTranscriptsRealtime(),
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

describe('LibraryView', () => {
  const renderLibraryView = () =>
    render(
      <TooltipProvider delayDuration={0}>
        <LibraryView />
      </TooltipProvider>
    )

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    mockDeleteTranscript.mockResolvedValue({ cleanupPendingKeys: [] })
    mockUseTranscriptsRealtime.mockReturnValue({
      transcripts: [makeTranscript()],
      isLoading: false,
      deleteTranscript: mockDeleteTranscript,
    })
  })

  test('opens dropdown on trigger click and closes on Escape', async () => {
    const user = userEventLib.setup()
    renderLibraryView()

    await screen.findByText('Transcript Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()
    })
  })

  test('calls deleteTranscript and closes the menu when delete is confirmed', async () => {
    const user = userEventLib.setup()

    renderLibraryView()
    await screen.findByText('Transcript Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
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
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()
  })

  test('reports cleanup pending as a neutral toast, not a failure', async () => {
    const user = userEventLib.setup()
    mockDeleteTranscript.mockResolvedValueOnce({
      cleanupPendingKeys: ['user/transcript/waveform.json'],
    })
    renderLibraryView()
    await screen.findByText('Transcript Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(TRANSCRIPT_CLEANUP_PENDING_TOAST)
    })
    expect(screen.queryByText(/Failed to delete transcript/i)).not.toBeInTheDocument()
  })

  test('does not delete and closes the menu when delete is canceled', async () => {
    const user = userEventLib.setup()

    renderLibraryView()
    await screen.findByText('Transcript Alpha')

    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    expect(await screen.findByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will permanently remove the transcript and all associated data. This action cannot be undone.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeleteTranscript).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument()
    })
  })
})
