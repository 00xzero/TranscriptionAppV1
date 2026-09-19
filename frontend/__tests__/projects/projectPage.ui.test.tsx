import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectPage from '@/app/projects/[projectId]/page'
import type { Project } from '@/contracts/db'
import {
  makeProject,
  makeTranscript,
  projectProviderData,
  rowTestIds,
  transcriptProviderData,
} from './fixtures'

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

  test('renders row-height skeletons while either dataset loads', () => {
    mockData([], [])
    mockUseProjectsData.mockReturnValue({
      ...projectProviderData([]),
      projectsLoading: true,
    })

    render(<ProjectPage />)

    const skeleton = screen.getByLabelText('Loading project')
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
    expect(screen.queryByText('This project is empty')).not.toBeInTheDocument()
  })

  test('renders the empty-project state when there are no children or direct transcripts', () => {
    mockData([makeCurrent()], [])

    render(<ProjectPage />)

    expect(screen.getByText('This project is empty')).toBeInTheDocument()
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
