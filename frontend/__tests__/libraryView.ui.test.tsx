import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEventLib from '@testing-library/user-event'
import LibraryView from '../components/LibraryView'
import type { Project, Transcript } from '../contracts/db'
import { TooltipProvider } from '../components/ui/tooltip'
import { TRANSCRIPT_CLEANUP_PENDING_TOAST } from '@/lib/transcripts/deleteErrors'
import { makeProject, projectProviderData, transcriptProviderData } from './projects/fixtures'

const mockGetUser = jest.fn()
const mockDeleteTranscript = jest.fn()
const mockUseProjectsData = jest.fn()
const mockUseTranscriptsData = jest.fn()
const mockCreateProject = jest.fn()
const mockRenameProject = jest.fn()
const mockFetchBranchCount = jest.fn()
const mockFetchSpeakerSummaries = jest.fn()
const mockToast = jest.fn()

function mockProjectsData(
  projects: Project[],
  transcripts: Transcript[],
  overrides: { projectsLoading?: boolean; transcriptsLoading?: boolean } = {}
) {
  mockUseProjectsData.mockReturnValue({
    ...projectProviderData(projects),
    createProject: mockCreateProject,
    renameProject: mockRenameProject,
    projectsLoading: overrides.projectsLoading ?? false,
  })
  mockUseTranscriptsData.mockReturnValue({
    ...transcriptProviderData(transcripts),
    deleteTranscript: mockDeleteTranscript,
    transcriptsLoading: overrides.transcriptsLoading ?? false,
  })
}

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjectBranchTranscriptCount: (...args: unknown[]) => mockFetchBranchCount(...args),
  fetchProjectSpeakerSummaries: (...args: unknown[]) => mockFetchSpeakerSummaries(...args),
}))

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
  useTranscriptsData: () => mockUseTranscriptsData(),
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
    mockCreateProject.mockResolvedValue(makeProject({ id: 'created' }))
    mockRenameProject.mockResolvedValue(makeProject({ id: 'p1', name: 'Renamed' }))
    mockFetchBranchCount.mockResolvedValue(0)
    mockFetchSpeakerSummaries.mockResolvedValue(new Map())
    mockProjectsData([], [makeTranscript()])
  })

  test('renders row-shaped placeholders while recent transcripts load', () => {
    mockProjectsData([], [makeTranscript()], { transcriptsLoading: true })

    renderLibraryView()

    const loadingState = screen.getByRole('status')
    const rows = loadingState.querySelectorAll('.animate-pulse.p-4')
    expect(loadingState).toHaveTextContent('Loading recent transcripts…')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => {
      expect(row).toHaveClass('min-h-18')
      expect(row).toHaveAttribute('aria-hidden', 'true')
    })
    const projectCarousel = screen.getByRole('region', { name: 'Recent projects' })
    expect(projectCarousel.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(screen.queryByText('Transcript Alpha')).not.toBeInTheDocument()
    expect(screen.queryByText(/No transcripts yet/)).not.toBeInTheDocument()
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

  test('ranks ground-level projects by branch activity and caps the carousel at six', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Transcript activity', updated_at: '2026-09-01T00:00:00Z' }),
      makeProject({ id: 'p2', name: 'Second', updated_at: '2026-09-04T00:00:00Z' }),
      makeProject({ id: 'p3', name: 'Third', updated_at: '2026-09-03T00:00:00Z' }),
      makeProject({ id: 'p4', name: 'Fourth', updated_at: '2026-09-02T00:00:00Z' }),
      makeProject({ id: 'p5', name: 'Fifth', updated_at: '2026-08-05T00:00:00Z' }),
      makeProject({ id: 'p6', name: 'Sixth', updated_at: '2026-08-04T00:00:00Z' }),
      makeProject({ id: 'p7', name: 'Too old', updated_at: '2026-08-01T00:00:00Z' }),
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
      'Open Fourth',
      'Open Fifth',
      'Open Sixth',
    ])
    expect(screen.queryByText('Too old')).not.toBeInTheDocument()
  })

  test('rolls nested activity and transcripts into the ground-level card', () => {
    const projects = [
      makeProject({ id: 'root', name: 'Client Work', updated_at: '2026-09-01T00:00:00Z' }),
      makeProject({
        id: 'child',
        name: 'Interviews',
        parent_id: 'root',
        updated_at: '2026-09-02T00:00:00Z',
      }),
      makeProject({
        id: 'grandchild',
        name: 'Round Two',
        parent_id: 'child',
        updated_at: '2026-09-03T00:00:00Z',
      }),
    ]
    mockProjectsData(projects, [
      makeTranscript({ id: 't1', project_id: 'child', updated_at: '2026-09-09T00:00:00Z' }),
      makeTranscript({ id: 't2', project_id: 'grandchild', updated_at: '2026-09-08T00:00:00Z' }),
    ])

    renderLibraryView()

    // The link wraps only the title now, so card content is asserted on the card.
    expect(screen.getByTitle('Open Client Work')).toBeInTheDocument()
    const rootCard = screen.getByTestId('recent-project-card-root')
    expect(rootCard).toHaveTextContent('2 transcripts total')
    expect(rootCard).toHaveTextContent('2 nested projects')
    expect(screen.queryByTitle('Open Interviews')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Open Round Two')).not.toBeInTheDocument()
  })

  test('excludes transcripts under a deleting descendant from the branch totals', () => {
    const projects = [
      makeProject({ id: 'root', name: 'Client Work' }),
      makeProject({
        id: 'child',
        name: 'Interviews',
        parent_id: 'root',
        deleting_at: '2026-09-15T00:00:00Z',
      }),
    ]
    mockProjectsData(projects, [
      makeTranscript({ id: 't1', project_id: 'root' }),
      makeTranscript({ id: 't2', project_id: 'child' }),
    ])

    renderLibraryView()

    const rootCard = screen.getByTestId('recent-project-card-root')
    expect(rootCard).toHaveTextContent('1 transcript total')
    expect(rootCard).toHaveTextContent('0 nested projects')
  })

  test('asks for branch speakers once for every card on the rail', async () => {
    mockFetchSpeakerSummaries.mockResolvedValue(new Map())
    mockProjectsData(
      [makeProject({ id: 'p1', name: 'One' }), makeProject({ id: 'p2', name: 'Two' })],
      []
    )

    renderLibraryView()

    // One request for the whole rail, never one per card, and branch-scoped to
    // match the "N transcripts total" rollups the cards show.
    await waitFor(() => expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(1))
    expect(mockFetchSpeakerSummaries).toHaveBeenCalledWith(['p1', 'p2'], {
      includeDescendants: true,
    })
  })

  test('renders the speakers a card was given', async () => {
    mockFetchSpeakerSummaries.mockResolvedValue(
      new Map([
        [
          'p1',
          {
            project_id: 'p1',
            speaker_count: 2,
            preview: [
              { id: 's1', transcriptId: 't1', label: 'Kate', color: null, paletteIndex: 0 },
              { id: 's2', transcriptId: 't1', label: 'John Smith', color: null, paletteIndex: 1 },
            ],
          },
        ],
      ])
    )
    mockProjectsData([makeProject({ id: 'p1', name: 'One' })], [])

    renderLibraryView()

    const group = await screen.findByRole('img', { name: '2 speakers: Kate and John Smith' })
    expect(group).toBeInTheDocument()
    expect(screen.getByText('JS')).toBeInTheDocument()
  })

  test('leaves the card intact when the speaker summary cannot be loaded', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchSpeakerSummaries.mockRejectedValue(new Error('rpc down'))
    mockProjectsData([makeProject({ id: 'p1', name: 'One' })], [])

    renderLibraryView()

    // Wait on the log rather than the absent group: the group is absent from the
    // first render too, so asserting it alone would pass before the rejection.
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        '[projects] Failed to load speaker summaries:',
        expect.any(Error)
      )
    )
    // Omitted rather than shown as "0 speakers", which would be a false claim.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTitle('Open One')).toBeInTheDocument()
    expect(screen.getByTestId('recent-project-card-p1')).toHaveTextContent('0 transcripts total')

    consoleError.mockRestore()
  })

  test('gives each slide a position label', () => {
    mockProjectsData(
      [makeProject({ id: 'p1', name: 'One' }), makeProject({ id: 'p2', name: 'Two' })],
      []
    )

    renderLibraryView()

    expect(screen.getByRole('group', { name: '1 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '2 of 2' })).toBeInTheDocument()
  })

  test.each([
    ['no', 0],
    ['a few', 3],
    ['more than the carousel shows', 7],
  ])('always ends the carousel with the creation tile (%s projects)', (_label, count) => {
    const roots = Array.from({ length: count }, (_unused, index) =>
      makeProject({ id: `p${index}`, name: `Project ${index}` })
    )
    mockProjectsData(roots, [])

    renderLibraryView()

    const tile = screen.getByRole('button', { name: 'New project folder' })
    const track = screen.getByRole('region', { name: 'Recent projects' })

    expect(track.lastElementChild).toBe(tile)
    // Six is the cap on project cards; the tile is extra and never competes for a slot.
    expect(screen.queryAllByTestId(/^recent-project-card-/)).toHaveLength(Math.min(count, 6))
  })

  test.each([
    ['a ground-level project', 'root', 'Client Work'],
    ['one level of nesting', 'child', 'Client Work / Interviews'],
    ['deeper nesting, with the middle elided', 'grandchild', 'Client Work / … / Round Two'],
    ['no project at all', null, 'Unfiled'],
  ])('labels a recent transcript sitting in %s', (_label, projectId, expected) => {
    const projects = [
      makeProject({ id: 'root', name: 'Client Work' }),
      makeProject({ id: 'child', name: 'Interviews', parent_id: 'root' }),
      makeProject({ id: 'grandchild', name: 'Round Two', parent_id: 'child' }),
    ]
    mockProjectsData(projects, [
      makeTranscript({ id: 't1', title: 'Kickoff', project_id: projectId }),
    ])

    renderLibraryView()

    expect(screen.getByTestId('transcript-row-t1')).toHaveTextContent(expected)
  })

  test('does not misclassify a missing project as Unfiled', () => {
    mockProjectsData([], [makeTranscript({ id: 't1', title: 'Orphan', project_id: 'gone' })])

    renderLibraryView()

    const row = screen.getByTestId('transcript-row-t1')
    expect(row).toHaveTextContent('4 mins')
    expect(row).not.toHaveTextContent('Unfiled')
    expect(row).not.toHaveTextContent('•')
  })

  test('keeps the card menu outside the card link', () => {
    mockProjectsData([makeProject({ id: 'p1', name: 'Client Work' })], [])

    renderLibraryView()

    const link = screen.getByTitle('Open Client Work')
    const menu = screen.getByRole('button', { name: 'More options for Client Work' })

    // A button nested inside the anchor would be invalid HTML and would swallow
    // keyboard activation. The title stays inside the link so activating it navigates.
    expect(link.contains(menu)).toBe(false)
    expect(link).toHaveTextContent('Client Work')

    // Tab order follows DOM order: the link comes first, as it does in ProjectRow.
    expect(link.compareDocumentPosition(menu)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  test('renames a project from the card menu', async () => {
    const user = userEventLib.setup()
    mockProjectsData([makeProject({ id: 'p1', name: 'Client Work' })], [])

    renderLibraryView()

    await user.click(screen.getByRole('button', { name: 'More options for Client Work' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    const input = await screen.findByLabelText('Project name')
    expect(input).toHaveValue('Client Work')

    await user.clear(input)
    await user.type(input, 'Client Archive')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(mockRenameProject).toHaveBeenCalledWith('p1', 'Client Archive')
    })
  })

  test('opens the delete dialog for the right project from the card menu', async () => {
    const user = userEventLib.setup()
    mockProjectsData(
      [
        makeProject({ id: 'p1', name: 'Client Work' }),
        makeProject({ id: 'p2', name: 'Other Work' }),
      ],
      []
    )

    renderLibraryView()

    await user.click(screen.getByRole('button', { name: 'More options for Other Work' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(
      await screen.findByRole('heading', { name: /Delete .Other Work.\?/ })
    ).toBeInTheDocument()
    expect(mockFetchBranchCount).toHaveBeenCalledWith('p2')
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

    expect(screen.getByRole('button', { name: 'New project folder' })).toBeInTheDocument()
    expect(screen.queryByText('Deleting project')).not.toBeInTheDocument()
  })
})
