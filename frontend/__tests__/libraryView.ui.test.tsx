import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import LibraryView from '../components/LibraryView'
import type { Project, Transcript } from '../contracts/db'
import { TooltipProvider } from '../components/ui/tooltip'
import { TRANSCRIPT_CLEANUP_PENDING_TOAST } from '@/lib/transcripts/deleteErrors'
import { makeProject, providerData } from './projects/fixtures'

const mockGetUser = jest.fn()
const mockDeleteTranscript = jest.fn()
const mockUseProjectsData = jest.fn()
const mockToast = jest.fn()

function mockProjectsData(
  projects: Project[],
  transcripts: Transcript[],
  overrides: { projectsLoading?: boolean } = {}
) {
  mockUseProjectsData.mockReturnValue({
    ...providerData(projects, transcripts),
    deleteTranscript: mockDeleteTranscript,
    ...overrides,
  })
}

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

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
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
    mockProjectsData([], [makeTranscript()])
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

  test('keeps a failed delete open with an inline error', async () => {
    const user = userEventLib.setup()
    mockDeleteTranscript.mockRejectedValueOnce(new Error('offline'))
    renderLibraryView()
    await screen.findByText('Transcript Alpha')
    await user.click(screen.getByRole('button', { name: /More options for Transcript Alpha/i }))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete transcript')
    expect(screen.getByText('Delete "Transcript Alpha"?')).toBeInTheDocument()
  })

  test('renders the three most recently active projects in ranked order', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Transcript activity', updated_at: '2026-09-01T00:00:00Z' }),
      makeProject({ id: 'p2', name: 'Second', updated_at: '2026-09-04T00:00:00Z' }),
      makeProject({ id: 'p3', name: 'Third', updated_at: '2026-09-03T00:00:00Z' }),
      makeProject({ id: 'p4', name: 'Too old', updated_at: '2026-08-01T00:00:00Z' }),
    ]
    mockProjectsData(projects, [
      makeTranscript({ id: 't1', project_id: 'p1', updated_at: '2026-09-05T00:00:00Z' }),
    ])

    const { container } = renderLibraryView()

    const projectLinks = Array.from(container.querySelectorAll('a[href^="/projects/"]'))
    expect(projectLinks.map((link) => link.getAttribute('title'))).toEqual([
      'Open Transcript activity',
      'Open Second',
      'Open Third',
    ])
    expect(screen.queryByText('Too old')).not.toBeInTheDocument()
  })

  test('shows a nested project parent path and direct and nested counts', () => {
    const projects = [
      makeProject({ id: 'root', name: 'Client Work' }),
      makeProject({ id: 'child', name: 'Interviews', parent_id: 'root' }),
      makeProject({ id: 'grandchild', name: 'Round Two', parent_id: 'child' }),
    ]
    mockProjectsData(projects, [makeTranscript({ id: 't1', project_id: 'child' })])

    renderLibraryView()

    expect(screen.getByTitle('Client Work')).toHaveTextContent('Client Work')
    const childCard = screen.getByTitle('Open Interviews')
    expect(childCard).toHaveTextContent('1 transcript')
    expect(childCard).toHaveTextContent('1 nested project')
  })

  test('shows project skeletons while either provider list is loading', () => {
    mockProjectsData([], [], { projectsLoading: true })

    const { container } = renderLibraryView()

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /Create your first project/i })).not.toBeInTheDocument()
  })

  test('links the no-projects invitation to Projects', () => {
    mockProjectsData([], [])

    renderLibraryView()

    expect(screen.getByRole('link', { name: /Create your first project/i })).toHaveAttribute(
      'href',
      '/projects'
    )
  })

  test('shows the invitation when every project is marked for deletion', () => {
    const projects = [
      makeProject({
        id: 'deleting',
        name: 'Deleting project',
        deleting_at: '2026-09-15T00:00:00Z',
      }),
    ]
    mockProjectsData(projects, [])

    renderLibraryView()

    expect(screen.getByRole('link', { name: /Create your first project/i })).toHaveAttribute(
      'href',
      '/projects'
    )
    expect(screen.queryByText('Deleting project')).not.toBeInTheDocument()
  })
})
