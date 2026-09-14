import React from 'react'
import { render, screen } from '@testing-library/react'
import { ProjectsProvider, useProjectsData } from '@/lib/projects/ProjectsProvider'
import { buildProjectTree, transcriptsInProject } from '@/core/projects/tree'
import type { Project, Transcript } from '@/contracts/db'

const mockUseAuthIdentity = jest.fn()
const mockUseProjectsRealtime = jest.fn()
const mockUseTranscriptsRealtime = jest.fn()

jest.mock('@/lib/supabase/hooks', () => ({
  useAuthIdentity: () => mockUseAuthIdentity(),
  useProjectsRealtime: (...args: unknown[]) => mockUseProjectsRealtime(...args),
  useTranscriptsRealtime: (...args: unknown[]) => mockUseTranscriptsRealtime(...args),
}))

const project = (id: string, userId = 'user-a'): Project => ({
  id,
  user_id: userId,
  parent_id: null,
  name: id,
  deleting_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
})

const transcript = (id: string, projectId: string | null): Transcript => ({
  id,
  user_id: 'user-a',
  project_id: projectId,
  title: id,
  status: 'completed',
  source_object_key: null,
  upload_intent_id: null,
  duration_seconds: null,
  waveform_object_key: null,
  waveform_status: 'skipped',
  waveform_points_per_second: null,
  waveform_version: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
})

const projectActions = {
  createProject: jest.fn(),
  renameProject: jest.fn(),
  mutate: jest.fn(),
  refetch: jest.fn(),
}

const transcriptActions = {
  deleteTranscript: jest.fn(),
  moveTranscript: jest.fn(),
  addTranscripts: jest.fn(),
  mutate: jest.fn(),
  refetch: jest.fn(),
}

function mockData(projects: Project[], transcripts: Transcript[]) {
  mockUseProjectsRealtime.mockReturnValue({
    projects,
    tree: buildProjectTree(projects),
    isLoading: false,
    error: null,
    connectionStatus: 'connected',
    ...projectActions,
  })
  mockUseTranscriptsRealtime.mockReturnValue({
    transcripts,
    isLoading: false,
    error: null,
    connectionStatus: 'connected',
    ...transcriptActions,
  })
}

function Consumer({ projectId = null }: { projectId?: string | null }) {
  const data = useProjectsData()
  const selected = transcriptsInProject(data.transcripts, projectId)
  return (
    <div>
      <span>{data.projectsLoading || data.transcriptsLoading ? 'loading' : 'settled'}</span>
      <span>{data.projects.map((item) => item.id).join(',')}</span>
      <span>{selected.map((item) => item.id).join(',')}</span>
    </div>
  )
}

describe('ProjectsProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseAuthIdentity.mockReturnValue({ userId: 'user-a', ready: true })
    mockData([project('project-a')], [transcript('transcript-a', 'project-a')])
  })

  test('owns one realtime hook per table regardless of consumer count', () => {
    render(
      <ProjectsProvider>
        <Consumer />
        <Consumer />
      </ProjectsProvider>
    )

    expect(mockUseProjectsRealtime).toHaveBeenCalledTimes(1)
    expect(mockUseTranscriptsRealtime).toHaveBeenCalledTimes(1)
    expect(mockUseProjectsRealtime).toHaveBeenCalledWith({
      enabled: true,
      userId: 'user-a',
    })
    expect(mockUseTranscriptsRealtime).toHaveBeenCalledWith({
      enabled: true,
      userId: 'user-a',
    })
  })

  test('fully disables both data owners without a user', () => {
    mockUseAuthIdentity.mockReturnValue({ userId: null, ready: true })
    mockData([], [])

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    expect(mockUseProjectsRealtime).toHaveBeenCalledWith({ enabled: false, userId: null })
    expect(mockUseTranscriptsRealtime).toHaveBeenCalledWith({ enabled: false, userId: null })
  })

  test('reports loading while authentication is unresolved without starting data hooks', () => {
    mockUseAuthIdentity.mockReturnValue({ userId: null, ready: false })
    mockData([], [])

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(mockUseProjectsRealtime).toHaveBeenCalledWith({ enabled: false, userId: null })
    expect(mockUseTranscriptsRealtime).toHaveBeenCalledWith({ enabled: false, userId: null })
  })

  test('derived lists reflect moves in the one shared transcript list', () => {
    const { rerender } = render(
      <ProjectsProvider>
        <Consumer projectId="project-a" />
      </ProjectsProvider>
    )
    expect(screen.getByText('transcript-a')).toBeInTheDocument()

    mockData([project('project-a'), project('project-b')], [
      transcript('transcript-a', 'project-b'),
    ])
    rerender(
      <ProjectsProvider>
        <Consumer projectId="project-a" />
      </ProjectsProvider>
    )

    expect(screen.queryByText('transcript-a')).not.toBeInTheDocument()
  })
})
