import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectPage from '@/app/projects/[projectId]/page'
import type { Project } from '@/contracts/db'
import { makeProject, makeTranscript, providerData, rowTestIds } from './fixtures'

const mockUseProjectsData = jest.fn()
const mockReplace = jest.fn()
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'current' }),
  useRouter: () => ({ replace: mockReplace }),
  notFound: () => mockNotFound(),
}))

const makeCurrent = (overrides: Partial<Project> = {}) =>
  makeProject({ id: 'current', name: 'Current', ...overrides })

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
    mockUseProjectsData.mockReturnValue(
      providerData([zulu, makeCurrent(), alpha], [older, newer])
    )

    const { container } = render(<ProjectPage />)

    expect(rowTestIds(container)).toEqual([
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

    const skeleton = screen.getByLabelText('Loading project')
    const rows = skeleton.querySelectorAll('.animate-pulse.p-4')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => expect(row).toHaveClass('min-h-18'))
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
      providerData([makeCurrent({ deleting_at: '2026-09-14T12:00:00Z' })], [])
    )

    render(<ProjectPage />)

    expect(screen.getByText('This project is being deleted')).toBeInTheDocument()
    expect(screen.queryByText('This project is empty')).not.toBeInTheDocument()
  })

  test('renders the empty-project state when there are no children or direct transcripts', () => {
    mockUseProjectsData.mockReturnValue(providerData([makeCurrent()], []))

    render(<ProjectPage />)

    expect(screen.getByText('This project is empty')).toBeInTheDocument()
  })

  test('navigates to the nearest surviving ancestor when the project vanishes', async () => {
    const root = makeProject({ id: 'root', name: 'Root' })
    const parent = makeProject({ id: 'parent', name: 'Parent', parent_id: 'root' })
    let data = providerData([root, parent, makeCurrent({ parent_id: 'parent' })], [])
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
    let data = providerData([makeCurrent()], [])
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
