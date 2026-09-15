import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ProjectsProvider, useProjectsData } from '@/lib/projects/ProjectsProvider'
import { transcriptsInProject } from '@/core/projects/tree'
import type { Project, Transcript } from '@/contracts/db'

const mockGetSession = jest.fn()
const mockGetUser = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockChannel = jest.fn()
const mockRemoveChannel = jest.fn()
const mockSetAuth = jest.fn()
const mockFetchProjects = jest.fn()
const mockFetchTranscripts = jest.fn()
let authStateHandler:
  | ((event: string, session: { user: { id: string } } | null) => void)
  | null = null

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjects: () => mockFetchProjects(),
  fetchTranscripts: () => mockFetchTranscripts(),
  createProject: jest.fn(),
  renameProject: jest.fn(),
  moveTranscriptToProject: jest.fn(),
  addTranscriptsToProject: jest.fn(),
  deleteTranscript: jest.fn(),
  fetchTranscriptById: jest.fn(),
  fetchTranscriptJobs: jest.fn(),
  fetchSpeakers: jest.fn(),
  updateTranscript: jest.fn(),
  createSpeaker: jest.fn(),
  updateSpeaker: jest.fn(),
  deleteSpeaker: jest.fn(),
}))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    realtime: { setAuth: mockSetAuth },
  }),
}))

function Consumer() {
  const data = useProjectsData()
  return (
    <div>
      <span data-testid="projects-loading">{String(data.projectsLoading)}</span>
      <span data-testid="project-ids">{data.projects.map((project) => project.id).join(',')}</span>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function project(id: string, userId: string): Project {
  return {
    id,
    user_id: userId,
    parent_id: null,
    name: id,
    deleting_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }
}

describe('ProjectsProvider realtime ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchProjects.mockResolvedValue([])
    mockFetchTranscripts.mockResolvedValue([])
    mockSetAuth.mockResolvedValue(undefined)
    authStateHandler = null
    mockOnAuthStateChange.mockImplementation((handler) => {
      authStateHandler = handler
      return {
        data: { subscription: { unsubscribe: jest.fn() } },
      }
    })
    mockChannel.mockImplementation(() => {
      let channel: { on: jest.Mock; subscribe: jest.Mock }
      channel = {
        on: jest.fn(() => channel),
        subscribe: jest.fn(() => channel),
      }
      return channel
    })
  })

  test('opens one channel per table plus one private delete-invalidation channel', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))

    render(
      <ProjectsProvider>
        <Consumer />
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
    expect(mockChannel.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^projects-changes:user_id=eq\.user-a:/),
        expect.stringMatching(/^transcripts-changes:user_id=eq\.user-a:/),
        'projects-v1:user-a',
      ])
    )
    expect(mockSetAuth).toHaveBeenCalledTimes(1)
    expect(mockChannel).toHaveBeenCalledWith('projects-v1:user-a', {
      config: { private: true },
    })
  })

  test('does not remount app content when auth resolves', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    const onMount = jest.fn()

    function MountProbe() {
      React.useEffect(() => {
        onMount()
      }, [])
      return null
    }

    render(
      <ProjectsProvider>
        <MountProbe />
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    expect(onMount).toHaveBeenCalledTimes(1)
  })

  test('does not fetch or open channels while signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('projects-loading')).toHaveTextContent('false')
    })
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockFetchProjects).not.toHaveBeenCalled()
    expect(mockFetchTranscripts).not.toHaveBeenCalled()
    expect(mockChannel).not.toHaveBeenCalled()
  })

  test('discards the previous account data immediately when identity changes', async () => {
    const nextProjects = deferred<Project[]>()
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    mockFetchProjects
      .mockResolvedValueOnce([project('project-a', 'user-a')])
      .mockReturnValueOnce(nextProjects.promise)

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('project-ids')).toHaveTextContent('project-a')
    })

    act(() => {
      authStateHandler?.('SIGNED_IN', { user: { id: 'user-b' } })
    })

    expect(screen.getByTestId('project-ids')).toBeEmptyDOMElement()
    expect(screen.getByTestId('projects-loading')).toHaveTextContent('true')

    await act(async () => {
      nextProjects.resolve([project('project-b', 'user-b')])
      await nextProjects.promise
    })

    await waitFor(() => {
      expect(screen.getByTestId('project-ids')).toHaveTextContent('project-b')
    })
    expect(screen.getByTestId('project-ids')).not.toHaveTextContent('project-a')
  })

  test('derived project lists follow a realtime move in the shared transcript list', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    const transcript = {
      id: 'transcript-a',
      user_id: 'user-a',
      project_id: 'project-a',
      updated_at: '2026-09-01T00:00:00Z',
    }
    mockFetchTranscripts.mockResolvedValue([transcript])

    function ProjectTranscripts({ projectId }: { projectId: string }) {
      const { transcripts } = useProjectsData()
      return (
        <span data-testid={projectId}>
          {transcriptsInProject(transcripts, projectId)
            .map((item) => item.id)
            .join(',')}
        </span>
      )
    }

    render(
      <ProjectsProvider>
        <ProjectTranscripts projectId="project-a" />
        <ProjectTranscripts projectId="project-b" />
      </ProjectsProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('project-a')).toHaveTextContent('transcript-a')
    })

    const transcriptChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('transcripts-changes:')
    )
    const transcriptChannel = mockChannel.mock.results[transcriptChannelIndex].value
    const onChange = transcriptChannel.on.mock.calls[0][2]

    act(() => {
      onChange({ eventType: 'UPDATE', new: { ...transcript, project_id: 'project-b' } })
    })

    expect(screen.getByTestId('project-a')).toBeEmptyDOMElement()
    expect(screen.getByTestId('project-b')).toHaveTextContent('transcript-a')
  })

  test('refetches only the table named by a private delete invalidation', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
      ([name]) => name === 'projects-v1:user-a'
    )
    const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
    const onDelete = invalidationChannel.on.mock.calls[0][2]
    mockFetchProjects.mockClear()
    mockFetchTranscripts.mockClear()

    act(() => onDelete({ payload: { table: 'transcripts' } }))
    await waitFor(() => expect(mockFetchTranscripts).toHaveBeenCalledTimes(1))
    expect(mockFetchProjects).not.toHaveBeenCalled()

    act(() => onDelete({ payload: { table: 'projects' } }))
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1))
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)
  })

  test('coalesces a burst into one in-flight and one trailing refetch per table', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
      ([name]) => name === 'projects-v1:user-a'
    )
    const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
    const onDelete = invalidationChannel.on.mock.calls[0][2]
    const firstRefetch = deferred<unknown[]>()
    mockFetchTranscripts.mockReset()
    mockFetchTranscripts
      .mockReturnValueOnce(firstRefetch.promise)
      .mockResolvedValue([])

    act(() => {
      for (let index = 0; index < 5; index += 1) {
        onDelete({ payload: { table: 'transcripts' } })
      }
    })

    expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstRefetch.resolve([])
      await firstRefetch.promise
    })

    await waitFor(() => expect(mockFetchTranscripts).toHaveBeenCalledTimes(2))
  })

  test('refetches both tables on initial subscribe and reconnect', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))

    render(
      <ProjectsProvider>
        <Consumer />
      </ProjectsProvider>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
      ([name]) => name === 'projects-v1:user-a'
    )
    const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
    const onStatus = invalidationChannel.subscribe.mock.calls[0][0]
    mockFetchProjects.mockClear()
    mockFetchTranscripts.mockClear()

    act(() => onStatus('SUBSCRIBED'))
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1))
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)

    act(() => onStatus('SUBSCRIBED'))
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(2))
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(2)
  })

  test('profiles realistic initial, reconciliation, realtime, and polling traffic', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-a' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    const projects = Array.from({ length: 250 }, (_, index) =>
      project(`project-${index}`, 'user-a')
    )
    const transcripts: Transcript[] = Array.from({ length: 2000 }, (_, index) => ({
      id: `transcript-${index}`,
      user_id: 'user-a',
      project_id: `project-${index % 250}`,
      title: `Transcript ${index}`,
      status: 'completed',
      source_object_key: null,
      upload_intent_id: null,
      duration_seconds: 60,
      waveform_object_key: null,
      waveform_status: 'skipped',
      waveform_points_per_second: null,
      waveform_version: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    }))
    mockFetchProjects.mockResolvedValue(projects)
    mockFetchTranscripts.mockResolvedValue(transcripts)
    const projectCommits: number[] = []
    const transcriptCommits: number[] = []
    const projectRenders: number[] = []

    function LargeProjectConsumer() {
      const data = useProjectsData()
      React.useEffect(() => { projectRenders.push(data.projects.length) })
      return <span data-testid="large-project-count">{data.projects.length}:{data.projects[0]?.name}</span>
    }

    function LargeTranscriptConsumer() {
      const data = useProjectsData()
      return <span data-testid="large-transcript-count">{data.transcripts.length}</span>
    }

    const { unmount } = render(
      <ProjectsProvider>
        <React.Profiler id="large-projects" onRender={(_id, _phase, duration) => projectCommits.push(duration)}>
          <LargeProjectConsumer />
        </React.Profiler>
        <React.Profiler id="large-transcripts" onRender={(_id, _phase, duration) => transcriptCommits.push(duration)}>
          <LargeTranscriptConsumer />
        </React.Profiler>
      </ProjectsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('large-project-count')).toHaveTextContent('250:project-0'))
    expect(screen.getByTestId('large-transcript-count')).toHaveTextContent('2000')
    expect(mockFetchProjects).toHaveBeenCalledTimes(1)
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)
    expect(projectCommits).toHaveLength(1)
    expect(transcriptCommits).toHaveLength(1)

    const projectChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('projects-changes:')
    )
    const projectChannel = mockChannel.mock.results[projectChannelIndex].value
    const projectRendersBeforeRealtime = projectRenders.length
    // The PR5 checkpoint observed one transcript-only consumer commit for this
    // project update. That current cost is recorded, not required behavior.
    await act(async () => {
      projectChannel.on.mock.calls[0][2]({
        eventType: 'UPDATE',
        new: { ...projects[0], name: 'Updated project' },
      })
    })
    await waitFor(() => expect(screen.getByTestId('large-project-count')).toHaveTextContent('Updated project'))
    expect(projectRenders.length - projectRendersBeforeRealtime).toBe(1)

    const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
      ([name]) => name === 'projects-v1:user-a'
    )
    const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
    mockFetchProjects.mockClear()
    mockFetchTranscripts.mockClear()
    act(() => invalidationChannel.subscribe.mock.calls[0][0]('SUBSCRIBED'))
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1))
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)

    const transcriptChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('transcripts-changes:')
    )
    const transcriptChannel = mockChannel.mock.results[transcriptChannelIndex].value
    mockFetchProjects.mockClear()
    mockFetchTranscripts.mockClear()
    jest.useFakeTimers()
    try {
      act(() => {
        projectChannel.subscribe.mock.calls[0][0]('TIMED_OUT')
        transcriptChannel.subscribe.mock.calls[0][0]('TIMED_OUT')
      })
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })
      expect(mockFetchProjects).toHaveBeenCalledTimes(1)
      expect(mockFetchTranscripts).toHaveBeenCalledTimes(1)
    } finally {
      try {
        unmount()
      } finally {
        jest.useRealTimers()
      }
    }
  })
})
