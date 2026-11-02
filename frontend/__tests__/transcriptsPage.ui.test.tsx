import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import TranscriptsPage from '@/app/(app)/transcripts/page'
import type { Transcript } from '@/contracts/db'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RealtimeScopeAbortError } from '@/lib/supabase/realtime'
import { setTestAuth } from './helpers/auth'
import { ACCOUNT_CHANGED_MESSAGE, EXPECTED_USER_HEADER } from '@/lib/auth/account-boundary'
import { getAccessToken } from '@/infra/workos/access-token'
import { fetchTags, fetchTranscriptTags } from '@/lib/supabase/queries'
import { TagsProvider } from '@/lib/tags/TagsProvider'

jest.mock('@/lib/auth/AuthProvider', () => require('@/__tests__/helpers/auth').authProviderMock)
jest.mock('@/infra/workos/access-token', () => ({
  getAccessToken: jest.fn(async () => 'token-for-a'),
  notifyAccountChanged: jest.fn(),
}))

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
  engine: 'deepgram',
  engine_model: null,
  language: 'en',
  detect_speakers: true,
  keep_filler_words: true,
  mask_profanity: false,
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
  useTranscriptsData: () => mockUseProjectsData(),
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
    setTestAuth({ userId: 'account-a', ready: true })
    jest.mocked(getAccessToken).mockResolvedValue('token-for-a')
    mockDeleteTranscript.mockResolvedValue(undefined)
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

  test('retry-start retains the original account while preflight is pending', async () => {
    let release!: (token: string) => void
    jest.mocked(getAccessToken).mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchMock })
    mockUseProjectsData.mockReturnValue({
      transcripts: [makeTranscript({ status: 'created' })], transcriptsLoading: false,
      transcriptConnectionStatus: 'connected', deleteTranscript: mockDeleteTranscript, refetchTranscripts: mockRefetch,
    })
    mockRefetch.mockResolvedValue(undefined)
    const user = userEventLib.setup()
    const view = renderTranscriptsPage()
    await user.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(getAccessToken).toHaveBeenCalledWith('account-a')
    expect(fetchMock).not.toHaveBeenCalled()
    setTestAuth({ userId: 'account-b', ready: true })
    view.rerender(<TooltipProvider delayDuration={0}><TranscriptsPage /></TooltipProvider>)
    release('token-for-a')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.get(EXPECTED_USER_HEADER)).toBe('account-a')
    expect(headers.get('x-idempotency-key')).toBeTruthy()
  })

  test('retry-start without an available account sends nothing', async () => {
    setTestAuth({ userId: null, ready: false })
    const fetchMock = jest.fn()
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchMock })
    mockUseProjectsData.mockReturnValue({
      transcripts: [makeTranscript({ status: 'created' })], transcriptsLoading: false,
      transcriptConnectionStatus: 'connected', deleteTranscript: mockDeleteTranscript, refetchTranscripts: mockRefetch,
    })
    const user = userEventLib.setup()
    renderTranscriptsPage()
    await user.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(await screen.findByText(ACCOUNT_CHANGED_MESSAGE, { exact: true })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('announces transcript loading without showing the empty state', () => {
    mockUseProjectsData.mockReturnValue({
      transcripts: [],
      transcriptsLoading: true,
      transcriptConnectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetchTranscripts: mockRefetch,
    })

    renderTranscriptsPage()

    expect(screen.getByRole('status')).toHaveTextContent('Loading transcripts…')
    expect(screen.queryByText('A page waiting for a voice')).not.toBeInTheDocument()
  })

  test('uses shared semantic styling for transcript actions without changing behavior', () => {
    mockUseProjectsData.mockReturnValue({
      transcripts: [
        makeTranscript({ id: 'complete-id', status: 'completed' }),
        makeTranscript({ id: 'ready-id', title: 'Ready', status: 'created' }),
      ],
      transcriptsLoading: false,
      transcriptConnectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetchTranscripts: mockRefetch,
    })

    renderTranscriptsPage()

    const completed = screen.getByRole('button', { name: 'Transcribed' })
    expect(completed).toBeDisabled()
    expect(completed).toHaveClass('bg-control', 'px-3', 'py-1.5', 'text-sm')

    const ready = screen.getByRole('button', { name: 'Transcribe' })
    expect(ready).toBeEnabled()
    expect(ready).toHaveClass('bg-transcribe', 'px-3', 'py-1.5', 'text-sm')
  })

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

  test('closes a cancelled delete without cleanup effects or an error', async () => {
    const user = userEventLib.setup()
    mockDeleteTranscript.mockRejectedValueOnce(new RealtimeScopeAbortError())
    renderTranscriptsPage()
    await screen.findByText('Transcript Alpha')

    await openDeleteDialog(user)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.queryByText('Delete "Transcript Alpha"?')).not.toBeInTheDocument()
    })
    expect(mockToast).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
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

  test('shows each transcript’s tags and filters the list by them', async () => {
    const user = userEventLib.setup()
    const alpha = makeTranscript()
    const beta = makeTranscript({ id: '33333333-3333-3333-3333-333333333333', title: 'Transcript Beta' })
    mockUseProjectsData.mockReturnValue({
      transcripts: [alpha, beta],
      transcriptsLoading: false,
      transcriptConnectionStatus: 'connected',
      deleteTranscript: mockDeleteTranscript,
      refetchTranscripts: mockRefetch,
    })
    const stamp = '2026-11-01T00:00:00Z'
    jest.mocked(fetchTags).mockResolvedValueOnce([
      { id: '44444444-4444-4444-4444-444444444444', user_id: alpha.user_id, name: 'Interview', color: '#4F638C', created_at: stamp, updated_at: stamp },
    ])
    jest.mocked(fetchTranscriptTags).mockResolvedValueOnce([
      { transcript_id: beta.id, tag_id: '44444444-4444-4444-4444-444444444444' },
    ])
    render(
      <TooltipProvider delayDuration={0}>
        <TagsProvider>
          <TranscriptsPage />
        </TagsProvider>
      </TooltipProvider>
    )

    const filter = await screen.findByRole('group', { name: 'Tags' })
    expect(screen.getAllByText('Interview')).toHaveLength(2)
    await user.click(within(filter).getByRole('button', { name: /^Interview/ }))
    expect(screen.queryByText('Transcript Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Transcript Beta')).toBeInTheDocument()
  })
})
