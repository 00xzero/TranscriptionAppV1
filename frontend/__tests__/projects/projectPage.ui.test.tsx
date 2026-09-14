import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectPage from '@/app/projects/[projectId]/page'
import type { Project, Transcript } from '@/contracts/db'
import { buildProjectTree } from '@/core/projects/tree'

const mockUseProjectsData = jest.fn()
const mockReplace = jest.fn()
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
let currentProjectId = 'current'

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: currentProjectId }),
  useRouter: () => ({ replace: mockReplace }),
  notFound: () => mockNotFound(),
}))

const makeProject = (overrides: Partial<Project>): Project => ({
  id: 'current',
  user_id: 'user-1',
  parent_id: null,
  name: 'Current',
  deleting_at: null,
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
  ...overrides,
})

const makeTranscript = (overrides: Partial<Transcript>): Transcript => ({
  id: 'transcript-a',
  user_id: 'user-1',
  project_id: 'current',
  title: 'Transcript A',
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: 120,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
  ...overrides,
})

function providerData(projects: Project[], transcripts: Transcript[]) {
  return {
    tree: buildProjectTree(projects),
    projectsLoading: false,
    projectError: null,
    refetchProjects: jest.fn().mockResolvedValue(undefined),
    transcripts,
    transcriptsLoading: false,
    transcriptError: null,
    refetchTranscripts: jest.fn().mockResolvedValue(undefined),
  }
}

describe('ProjectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentProjectId = 'current'
  })

  test('renders child projects before direct transcripts in their defined order', () => {
    const current = makeProject({})
    const alpha = makeProject({ id: 'alpha', name: 'Alpha', parent_id: 'current' })
    const zulu = makeProject({ id: 'zulu', name: 'Zulu', parent_id: 'current' })
    const older = makeTranscript({
      id: 'older',
      title: 'Older',
      updated_at: '2026-09-01T10:00:00Z',
    })
    const newer = makeTranscript({
      id: 'newer',
      title: 'Newer',
      updated_at: '2026-09-01T11:00:00Z',
    })
    mockUseProjectsData.mockReturnValue(
      providerData([zulu, current, alpha], [older, newer])
    )

    const { container } = render(<ProjectPage />)
    const rows = [...container.querySelectorAll('[data-testid^="project-row-"], [data-testid^="transcript-row-"]')]
      .map((row) => row.getAttribute('data-testid'))

    expect(rows).toEqual([
      'project-row-alpha',
      'project-row-zulu',
      'transcript-row-newer',
      'transcript-row-older',
    ])
  })

  test('renders row-height skeletons while either dataset loads', () => {
    mockUseProjectsData.mockReturnValue({
      ...providerData([], []),
      projectsLoading: true,
    })

    render(<ProjectPage />)

    expect(screen.getByLabelText('Loading project')).toBeInTheDocument()
    expect(screen.getAllByText('', { selector: '.min-h-18' })).toHaveLength(3)
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('renders a retryable load error and never falls through to not-found', async () => {
    const data = {
      ...providerData([], []),
      projectError: new Error('offline'),
    }
    mockUseProjectsData.mockReturnValue(data)

    render(<ProjectPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(data.refetchProjects).toHaveBeenCalled()
      expect(data.refetchTranscripts).toHaveBeenCalled()
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('calls notFound only after a clean load confirms the id is absent', () => {
    mockUseProjectsData.mockReturnValue(providerData([], []))

    expect(() => render(<ProjectPage />)).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  test('renders the deleting state instead of project contents', () => {
    mockUseProjectsData.mockReturnValue(
      providerData([makeProject({ deleting_at: '2026-09-14T12:00:00Z' })], [])
    )

    render(<ProjectPage />)

    expect(screen.getByText('This project is being deleted')).toBeInTheDocument()
    expect(screen.queryByText('This project is empty')).not.toBeInTheDocument()
  })

  test('renders the empty-project state when there are no children or direct transcripts', () => {
    mockUseProjectsData.mockReturnValue(providerData([makeProject({})], []))

    render(<ProjectPage />)

    expect(screen.getByText('This project is empty')).toBeInTheDocument()
  })

  test('navigates to the nearest surviving ancestor when the project vanishes', async () => {
    const root = makeProject({ id: 'root', name: 'Root' })
    const parent = makeProject({ id: 'parent', name: 'Parent', parent_id: 'root' })
    const current = makeProject({ parent_id: 'parent' })
    let data = providerData([root, parent, current], [])
    mockUseProjectsData.mockImplementation(() => data)
    const view = render(<ProjectPage />)

    await screen.findByRole('heading', { name: 'Current' })
    await act(async () => {})
    data = providerData([root, parent], [])
    view.rerender(<ProjectPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/projects/parent')
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  test('falls back to the Projects root when no ancestor survives', async () => {
    const current = makeProject({})
    let data = providerData([current], [])
    mockUseProjectsData.mockImplementation(() => data)
    const view = render(<ProjectPage />)

    await screen.findByRole('heading', { name: 'Current' })
    await act(async () => {})
    data = providerData([], [])
    view.rerender(<ProjectPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/projects')
    })
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
