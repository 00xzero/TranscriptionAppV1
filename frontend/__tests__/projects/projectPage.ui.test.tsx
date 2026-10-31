import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectPage from '@/app/(app)/projects/[projectId]/page'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Project } from '@/contracts/db'
import {
  makeProject,
  makeTranscript,
  projectProviderData,
  rowTestIds,
  transcriptProviderData,
} from './fixtures'

const mockFetchSpeakerSummaries = jest.fn()
const mockFetchProjectPeople = jest.fn()

jest.mock('@/lib/auth/AuthProvider', () => ({ useAuth: () => ({ userId: 'app-user-a' }) }))

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjectSpeakerSummaries: (...args: unknown[]) => mockFetchSpeakerSummaries(...args),
  fetchProjectPeople: (...args: unknown[]) => mockFetchProjectPeople(...args),
  fetchPersonAppearances: jest.fn().mockResolvedValue([]),
}))

const mockUseProjectsData = jest.fn()
const mockUseTranscriptsData = jest.fn()
const mockReplace = jest.fn()
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
  useTranscriptsData: () => mockUseTranscriptsData(),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'current' }),
  useRouter: () => ({ replace: mockReplace }),
  notFound: () => mockNotFound(),
  // The people dialog lives in the address, as the router would report it.
  useSearchParams: () => jest.requireActual('../helpers/locationSearchParams').useLocationSearchParams(),
}))

const makeCurrent = (overrides: Partial<Project> = {}) =>
  makeProject({ id: 'current', name: 'Current', ...overrides })

function mockData(projects: Project[], transcripts: ReturnType<typeof makeTranscript>[]) {
  const projectData = projectProviderData(projects)
  const transcriptData = transcriptProviderData(transcripts)
  mockUseProjectsData.mockReturnValue(projectData)
  mockUseTranscriptsData.mockReturnValue(transcriptData)
  return { projectData, transcriptData }
}

describe('ProjectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Left pending by default: these tests assert synchronously, and a summary
    // resolving after the test body would settle state outside act(). Tests that
    // care about speakers resolve it themselves.
    mockFetchSpeakerSummaries.mockReturnValue(new Promise(() => {}))
    window.history.replaceState(null, '', '/projects/current')
    sessionStorage.clear()
  })

  describe('speakers', () => {
    test('asks for the whole branch, as the people dialog lists it', async () => {
      mockData([makeCurrent(), makeProject({ id: 'child', parent_id: 'current' })], [])

      render(<ProjectPage />)

      await waitFor(() => expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(1))
      expect(mockFetchSpeakerSummaries).toHaveBeenCalledWith(['current'], {
        includeDescendants: true,
      })
    })

    test('asks again when a transcript in a sub-project changes', async () => {
      mockFetchSpeakerSummaries.mockResolvedValue(new Map())
      const child = makeProject({ id: 'child', parent_id: 'current' })
      const nested = makeTranscript({ id: 'nested', project_id: 'child', updated_at: '2026-09-01T00:00:00Z' })
      mockData([makeCurrent(), child], [nested])
      const { rerender } = render(<ProjectPage />)
      await waitFor(() => expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(1))

      mockData([makeCurrent(), child], [{ ...nested, updated_at: '2026-09-02T00:00:00Z' }])
      rerender(<ProjectPage />)

      await waitFor(() => expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(2))
    })

    test('does not ask until the project has resolved', async () => {
      // Provider still loading: the route id is not yet known to be a real,
      // active project, and may not even be a uuid.
      mockUseProjectsData.mockReturnValue({
        ...projectProviderData([]),
        projectsLoading: true,
      })
      mockUseTranscriptsData.mockReturnValue({
        ...transcriptProviderData([]),
        transcriptsLoading: true,
      })

      render(<ProjectPage />)

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading project…'))
      expect(mockFetchSpeakerSummaries).not.toHaveBeenCalled()
    })

    test('does not ask for a project that is being deleted', async () => {
      mockData([makeCurrent({ deleting_at: '2026-09-15T00:00:00Z' })], [])

      render(<ProjectPage />)

      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
      expect(mockFetchSpeakerSummaries).not.toHaveBeenCalled()
    })

    test('shows the speaker group beside the counts', async () => {
      mockFetchSpeakerSummaries.mockResolvedValue(
        new Map([
          [
            'current',
            {
              project_id: 'current',
              speaker_count: 5,
              preview: [
                { kind: 'person', id: 's1', name: 'Kate', color: '#4F638C', organisationName: null },
                { kind: 'person', id: 's2', name: 'John', color: '#4F638C', organisationName: null },
                { kind: 'person', id: 's3', name: 'Sarah', color: '#4F638C', organisationName: null },
                { kind: 'person', id: 's4', name: 'Mark', color: '#4F638C', organisationName: null },
              ],
            },
          ],
        ])
      )
      mockData([makeCurrent()], [])

      render(<ProjectPage />)

      // Five speakers do not fit five circles, so the last slot is the badge.
      expect(
        await screen.findByRole('img', { name: '5 speakers: Kate, John, Sarah and 2 more' })
      ).toBeInTheDocument()
      expect(screen.getByText('+2')).toBeInTheDocument()
    })

    describe('people dialog', () => {
      const summary = (count: number) => new Map([[
        'current',
        {
          project_id: 'current',
          speaker_count: count,
          preview: [{ kind: 'person', id: 's1', name: 'Kate', color: '#4F638C', organisationName: null }],
        },
      ]])
      const people = (names: string[]) => ({
        people: names.map((name, index) => ({
          id: `p${index}`, name, preferred_color: '#4F638C', organisation_name: null, hidden: false,
          transcript_count: 1, talk_ms: 60_000, last_seen_at: '2026-10-01T00:00:00Z',
        })),
        voices: [],
      })

      test('the speaker faces open it', async () => {
        const user = userEvent.setup()
        mockFetchSpeakerSummaries.mockResolvedValue(summary(2))
        mockFetchProjectPeople.mockResolvedValue(people(['Kate', 'John']))
        mockData([makeCurrent()], [])
        render(<ProjectPage />, { wrapper: TooltipProvider })

        const button = await screen.findByRole('button', { name: 'Speakers in Current: 2 speakers' })
        expect(button).toHaveAttribute('aria-haspopup', 'dialog')
        expect(mockFetchProjectPeople).not.toHaveBeenCalled()

        await user.click(button)

        expect(await screen.findByRole('dialog', { name: 'People in Current' })).toBeInTheDocument()
        expect(await screen.findByTestId('person-row-p1')).toBeInTheDocument()
        expect(mockFetchProjectPeople).toHaveBeenCalledWith('current')
        expect(button).toHaveAttribute('aria-expanded', 'true')
        // Held in the address, so Back closes it and coming back reopens it.
        expect(window.location.search).toBe('?people')
      })

      test('an address with the dialog in it opens the page with it open', async () => {
        mockFetchSpeakerSummaries.mockResolvedValue(summary(2))
        mockFetchProjectPeople.mockResolvedValue(people(['Kate', 'John']))
        window.history.replaceState(null, '', '/projects/current?people')
        mockData([makeCurrent()], [])
        render(<ProjectPage />, { wrapper: TooltipProvider })

        expect(await screen.findByRole('dialog', { name: 'People in Current' })).toBeInTheDocument()
        expect(await screen.findByTestId('person-row-p1')).toBeInTheDocument()
      })

      test('the faces are no button while there is nobody to show', async () => {
        mockFetchSpeakerSummaries.mockResolvedValue(new Map([['current', { project_id: 'current', speaker_count: 0, preview: [] }]]))
        mockData([makeCurrent()], [])
        render(<ProjectPage />, { wrapper: TooltipProvider })

        expect(await screen.findByText('No speakers yet!')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Speakers in/ })).not.toBeInTheDocument()
      })

      test('a fresher count from the dialog makes the header read again, once', async () => {
        const user = userEvent.setup()
        mockFetchSpeakerSummaries.mockResolvedValue(summary(2))
        mockFetchProjectPeople.mockResolvedValue(people(['Kate', 'John', 'Sarah']))
        mockData([makeCurrent()], [])
        render(<ProjectPage />, { wrapper: TooltipProvider })

        await user.click(await screen.findByRole('button', { name: 'Speakers in Current: 2 speakers' }))
        await screen.findByTestId('person-row-p2')

        await waitFor(() => expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(2))
        // The header still says 2: no second reload, no loop.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
        expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(2)
      })

      test('a matching count leaves the header alone', async () => {
        const user = userEvent.setup()
        mockFetchSpeakerSummaries.mockResolvedValue(summary(2))
        mockFetchProjectPeople.mockResolvedValue(people(['Kate', 'John']))
        mockData([makeCurrent()], [])
        render(<ProjectPage />, { wrapper: TooltipProvider })

        await user.click(await screen.findByRole('button', { name: 'Speakers in Current: 2 speakers' }))
        await screen.findByTestId('person-row-p1')

        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
        expect(mockFetchSpeakerSummaries).toHaveBeenCalledTimes(1)
      })
    })
  })

  test('renders child projects before direct transcripts in their defined order', () => {
    const alpha = makeProject({ id: 'alpha', name: 'Alpha', parent_id: 'current' })
    const zulu = makeProject({ id: 'zulu', name: 'Zulu', parent_id: 'current' })
    const older = makeTranscript({
      id: 'older',
      project_id: 'current',
      updated_at: '2026-09-01T10:00:00Z',
    })
    const newer = makeTranscript({
      id: 'newer',
      project_id: 'current',
      updated_at: '2026-09-01T11:00:00Z',
    })
    mockData([zulu, makeCurrent(), alpha], [older, newer])

    const { container } = render(<ProjectPage />)

    expect(rowTestIds(container)).toEqual([
      'project-row-alpha',
      'project-row-zulu',
      'transcript-row-newer',
      'transcript-row-older',
    ])
  })

  test('summarizes direct transcripts and nested projects in the header', () => {
    const child = makeProject({ id: 'child', name: 'Child', parent_id: 'current' })
    mockData(
      [makeCurrent(), child],
      [
        makeTranscript({ id: 'direct', project_id: 'current' }),
        makeTranscript({ id: 'nested', project_id: 'child' }),
      ]
    )

    render(<ProjectPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Current' })).toBeInTheDocument()
    expect(screen.getByText('1 transcript · 1 nested project')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Sub-projects' })).toBeInTheDocument()
    expect(screen.getByText('1 project')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Transcripts' })).toBeInTheDocument()
    expect(screen.getByText('1 transcript')).toBeInTheDocument()
  })

  test('renders row-height skeletons while either dataset loads', async () => {
    mockData([], [])
    mockUseProjectsData.mockReturnValue({
      ...projectProviderData([]),
      projectsLoading: true,
    })

    render(<ProjectPage />)

    const skeleton = screen.getByRole('status')
    await waitFor(() => expect(skeleton).toHaveTextContent('Loading project…'))
    const rows = skeleton.querySelectorAll('.animate-pulse.p-4')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => expect(row).toHaveClass('min-h-18'))
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('renders a retryable load error and never falls through to not-found', async () => {
    const data = {
      ...projectProviderData([]),
      projectError: new Error('offline'),
    }
    mockUseProjectsData.mockReturnValue(data)
    const transcriptData = transcriptProviderData([])
    mockUseTranscriptsData.mockReturnValue(transcriptData)

    render(<ProjectPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(data.refetchProjects).toHaveBeenCalled()
      expect(transcriptData.refetchTranscripts).toHaveBeenCalled()
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('calls notFound only after a clean load confirms the id is absent', () => {
    mockData([], [])

    expect(() => render(<ProjectPage />)).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  test('renders the deleting state instead of project contents', () => {
    mockData([makeCurrent({ deleting_at: '2026-09-14T12:00:00Z' })], [])

    render(<ProjectPage />)

    expect(screen.getByText('This project is being deleted')).toBeInTheDocument()
    expect(screen.queryByText('Room for transcripts')).not.toBeInTheDocument()
  })

  test('renders the empty-project state when there are no children or direct transcripts', () => {
    mockData([makeCurrent()], [])

    render(<ProjectPage />)

    expect(screen.getByText('Room for transcripts')).toBeInTheDocument()
  })

  test('creates a nested project and exposes add, project, and transcript actions', async () => {
    const user = userEvent.setup()
    const child = makeProject({ id: 'child', name: 'Child', parent_id: 'current' })
    const transcript = makeTranscript({ id: 'note', title: 'Project note', project_id: 'current' })
    const { projectData } = mockData([makeCurrent(), child], [transcript])
    projectData.createProject.mockResolvedValue(makeProject({ id: 'created', name: 'Nested', parent_id: 'current' }))
    render(<ProjectPage />)

    expect(screen.getByRole('button', { name: 'Add Transcripts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More options for Current' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More options for Child' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More options for Project note' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Nested')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(projectData.createProject).toHaveBeenCalledWith({ name: 'Nested', parent_id: 'current' }))
  })

  test('offers Retry Delete without project capture controls for a deleting branch', () => {
    mockData([makeCurrent({ deleting_at: '2026-09-14T12:00:00Z' })], [])

    render(<ProjectPage />)

    expect(screen.getByRole('button', { name: 'Retry Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Transcripts' })).not.toBeInTheDocument()
  })

  test('navigates to the nearest surviving ancestor when the project vanishes', async () => {
    const root = makeProject({ id: 'root', name: 'Root' })
    const parent = makeProject({ id: 'parent', name: 'Parent', parent_id: 'root' })
    let data = projectProviderData([root, parent, makeCurrent({ parent_id: 'parent' })])
    mockUseProjectsData.mockImplementation(() => data)
    mockUseTranscriptsData.mockReturnValue(transcriptProviderData([]))
    const view = render(<ProjectPage />)

    await screen.findByRole('heading', { name: 'Current' })
    await act(async () => {})
    data = projectProviderData([root, parent])
    view.rerender(<ProjectPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/projects/parent')
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('falls back to the Projects root when no ancestor survives', async () => {
    let data = projectProviderData([makeCurrent()])
    mockUseProjectsData.mockImplementation(() => data)
    mockUseTranscriptsData.mockReturnValue(transcriptProviderData([]))
    const view = render(<ProjectPage />)

    await screen.findByRole('heading', { name: 'Current' })
    await act(async () => {})
    data = projectProviderData([])
    view.rerender(<ProjectPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/projects')
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
