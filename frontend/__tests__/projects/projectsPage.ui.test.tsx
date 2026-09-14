import React from 'react'
import { render, screen } from '@testing-library/react'
import ProjectsPage from '@/app/projects/page'
import type { Project, Transcript } from '@/contracts/db'
import { buildProjectTree } from '@/core/projects/tree'

const mockUseProjectsData = jest.fn()

jest.mock('@/lib/projects/ProjectsProvider', () => ({
  useProjectsData: () => mockUseProjectsData(),
}))

const makeProject = (overrides: Partial<Project>): Project => ({
  id: 'project-a',
  user_id: 'user-1',
  parent_id: null,
  name: 'Alpha',
  deleting_at: null,
  created_at: '2026-09-01T12:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
  ...overrides,
})

const makeTranscript = (overrides: Partial<Transcript>): Transcript => ({
  id: 'transcript-a',
  user_id: 'user-1',
  project_id: null,
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

    const rows = [...container.querySelectorAll('[data-testid^="project-row-"], [data-testid^="transcript-row-"]')]
      .map((row) => row.getAttribute('data-testid'))
    expect(rows).toEqual([
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
      providerData([makeProject({})], [makeTranscript({ project_id: 'project-a' })])
    )

    render(<ProjectsPage />)

    expect(screen.getByText('No unfiled transcripts')).toBeInTheDocument()
  })

  test('keeps a page heading when only Unfiled transcripts exist', () => {
    mockUseProjectsData.mockReturnValue(providerData([], [makeTranscript({})]))

    render(<ProjectsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Unfiled' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transcript A' })).not.toBeInTheDocument()
  })
})
