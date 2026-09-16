import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectsPage from '@/app/projects/page'
import { makeProject, makeTranscript, providerData, rowTestIds } from './fixtures'

const mockUseProjectsData = jest.fn()

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

describe('ProjectsPage', () => {
  test('renders projects before Unfiled with project and transcript ordering', () => {
    const alpha = makeProject({ id: 'alpha', name: 'Alpha' })
    const child = makeProject({ id: 'child', name: 'Child', parent_id: 'alpha' })
    const zulu = makeProject({ id: 'zulu', name: 'Zulu' })
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
    const filed = makeTranscript({ id: 'filed', title: 'Filed', project_id: 'alpha' })
    mockUseProjectsData.mockReturnValue(
      providerData([zulu, child, alpha], [older, filed, newer])
    )

    const { container } = render(<ProjectsPage />)

    expect(rowTestIds(container)).toEqual([
      'project-row-alpha',
      'project-row-zulu',
      'transcript-row-newer',
      'transcript-row-older',
    ])
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).not.toHaveClass(
      'sr-only'
    )
    expect(screen.getByText('1 transcript · 1 nested project')).toBeInTheDocument()
    expect(screen.getByText('2 transcripts')).toBeInTheDocument()
  })

  test('waits for both provider datasets before showing content', () => {
    mockUseProjectsData.mockReturnValue({
      ...providerData([], []),
      transcriptsLoading: true,
    })

    render(<ProjectsPage />)

    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument()
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
  })

  test('renders the combined empty state only when projects and Unfiled are empty', () => {
    mockUseProjectsData.mockReturnValue(providerData([], []))

    render(<ProjectsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unfiled' })).not.toBeInTheDocument()
  })

  test('renders the empty Unfiled state when projects exist without unfiled transcripts', () => {
    mockUseProjectsData.mockReturnValue(
      providerData([makeProject()], [makeTranscript({ project_id: 'project-a' })])
    )

    render(<ProjectsPage />)

    expect(screen.getByText('No unfiled transcripts')).toBeInTheDocument()
  })

  test('keeps a page heading when only Unfiled transcripts exist', () => {
    mockUseProjectsData.mockReturnValue(providerData([], [makeTranscript()]))

    render(<ProjectsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Unfiled' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Unfiled' }).closest('section'))
      .toHaveAttribute('id', 'unfiled')
    expect(screen.queryByRole('heading', { name: 'Transcript A' })).not.toBeInTheDocument()
  })

  test('creates a root project and owns one shared dialog for all project rows', async () => {
    const user = userEvent.setup()
    const alpha = makeProject({ id: 'alpha', name: 'Alpha' })
    const zulu = makeProject({ id: 'zulu', name: 'Zulu' })
    const data = providerData([alpha, zulu], [])
    data.createProject.mockResolvedValue(makeProject({ id: 'created', name: 'Created' }))
    mockUseProjectsData.mockReturnValue(data)
    render(<ProjectsPage />)

    expect(screen.getAllByRole('button', { name: /More options for/i })).toHaveLength(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New Project' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Created')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(data.createProject).toHaveBeenCalledWith({ name: 'Created', parent_id: null }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('uses the shared transcript menu for Unfiled rows', async () => {
    const user = userEvent.setup()
    mockUseProjectsData.mockReturnValue(providerData([], [makeTranscript({ title: 'Unfiled note' })]))
    render(<ProjectsPage />)

    await user.click(screen.getByRole('button', { name: 'More options for Unfiled note' }))
    expect(screen.getByRole('menuitem', { name: 'Move to Project…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})
