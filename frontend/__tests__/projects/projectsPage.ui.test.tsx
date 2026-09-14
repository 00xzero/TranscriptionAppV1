import React from 'react'
import { render, screen } from '@testing-library/react'
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
    expect(screen.queryByRole('heading', { name: 'Transcript A' })).not.toBeInTheDocument()
  })
})
