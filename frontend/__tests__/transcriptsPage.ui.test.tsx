import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import TranscriptsPage from '@/app/transcripts/page'
import type { Transcript } from '@/contracts/db'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TRANSCRIPT_CLEANUP_PENDING_TOAST } from '@/lib/transcripts/deleteErrors'

const mockToast = jest.fn()

jest.mock('@/components/ui/toaster', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

const mockDeleteTranscript = jest.fn()
const mockRefetch = jest.fn()
const mockReplace = jest.fn()
const mockOpenCaptureModal = jest.fn()
const mockUseProjectsData = jest.fn()
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(global, 'fetch')

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

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
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
    mockDeleteTranscript.mockResolvedValue({ cleanupPendingKeys: [] })
    mockUseProjectsData.mockReturnValue({
      transcripts: [makeTranscript()],
      transcriptsLoading: false,
      transcriptConnectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetchTranscripts: mockRefetch,
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalFetchDescriptor) Object.defineProperty(global, 'fetch', originalFetchDescriptor)
    else Reflect.deleteProperty(global, 'fetch')
  })

  const openDeleteDialog = async (user: ReturnType<typeof userEventLib.setup>) => {
    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  }

  test('deletes a transcript after alert dialog confirmation', async () => {
    const user = userEventLib.setup()
    renderTranscriptsPage()

    await screen.findByText('Transcript Alpha')
    await openDeleteDialog(user)

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
    await openDeleteDialog(user)

    expect(await screen.findByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will permanently remove the transcript and all associated data. This action cannot be undone.'
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockDeleteTranscript).not.toHaveBeenCalled()
  })

  test('reports cleanup pending as a neutral toast, not a failure', async () => {
    const user = userEventLib.setup()
    mockDeleteTranscript.mockResolvedValueOnce({
      cleanupPendingKeys: ['user/transcript/waveform.json'],
    })
    renderTranscriptsPage()
    await screen.findByText('Transcript Alpha')

    await openDeleteDialog(user)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(TRANSCRIPT_CLEANUP_PENDING_TOAST)
    })
    expect(screen.queryByText(/Failed to delete transcript/i)).not.toBeInTheDocument()
  })

  test('keeps a failed delete open with an inline error', async () => {
    const user = userEventLib.setup()
    mockDeleteTranscript.mockRejectedValueOnce(new Error('offline'))
    renderTranscriptsPage()
    await screen.findByText('Transcript Alpha')
    await openDeleteDialog(user)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete transcript')
    expect(screen.getByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
  })

  test('preserves a transcription-start error when another transcript is deleted', async () => {
    const user = userEventLib.setup()
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: 'Start failed' }),
      } as Response),
    })
    mockUseProjectsData.mockReturnValue({
      transcripts: [
        makeTranscript({ id: 'start-id', title: 'Start failure', status: 'created' }),
        makeTranscript({ id: 'delete-id', title: 'Delete me' }),
      ],
      transcriptsLoading: false,
      transcriptConnectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetchTranscripts: mockRefetch,
    })
    renderTranscriptsPage()

    await user.click(screen.getByRole('button', { name: 'Transcribe' }))
    const startError = await screen.findByText(/Failed to start transcript: Start failed/)

    await user.click(screen.getByRole('button', { name: /More options for Delete me/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockDeleteTranscript).toHaveBeenCalledWith('delete-id'))
    expect(startError).toBeInTheDocument()
  })
})
