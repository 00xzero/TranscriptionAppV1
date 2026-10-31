import React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  ProjectsProvider,
  useProjectsData,
  useTranscriptsData,
} from '@/lib/projects/ProjectsProvider'
import { transcriptsInProject } from '@/core/projects/tree'
import { AuthProvider } from '@/lib/auth/AuthProvider'
import { useProjectsDeleteInvalidation } from '@/lib/supabase/hooks'
import { RealtimeScopeAbortError } from '@/lib/supabase/realtime'
import type { Project, Transcript, TranscriptSummary } from '@/contracts/db'
import {
  accessTokenFor,
  resetAuthKitState,
  setAuthKitState,
  workosUser,
} from '@/__mocks__/workos-authkit-nextjs-components'

// Realtime transcript rows are validated, so these ids must be real UUIDs.
const TRANSCRIPT_A = '00000000-0000-4000-8000-00000000000a'
const PROJECT_A = '00000000-0000-4000-8000-0000000000a1'
const PROJECT_B = '00000000-0000-4000-8000-0000000000b1'

const transcriptSummary = (overrides: Partial<TranscriptSummary> = {}): TranscriptSummary => ({
  id: TRANSCRIPT_A,
  project_id: null,
  title: 'Transcript A',
  status: 'completed',
  duration_seconds: 60,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...overrides,
})

const mockRpc = jest.fn()
const mockChannel = jest.fn()
const mockRemoveChannel = jest.fn()
const mockSetAuth = jest.fn()
const mockFetchProjects = jest.fn()
const mockFetchTranscripts = jest.fn()
type FakeChannel = {
  topic: string
  on: jest.Mock
  subscribe: jest.Mock
}
const mockActiveChannels: FakeChannel[] = []
// Our user id that current_user_id() resolves the signed-in WorkOS user to.
let mockCurrentAppUserId: string | null = null

function signInAs(appUserId: string) {
  mockCurrentAppUserId = appUserId
  // A sign-in writes the account cookie with the session (account-marker.ts).
  document.cookie = `olivetti-account=${appUserId}; path=/`
  setAuthKitState({ user: workosUser(`workos-${appUserId}`) })
}

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjects: () => mockFetchProjects(),
  fetchTranscriptSummaries: () => mockFetchTranscripts(),
  createProject: jest.fn(),
  renameProject: jest.fn(),
  moveTranscriptToProject: jest.fn(),
  addTranscriptsToProject: jest.fn(),
  deleteTranscript: jest.fn(),
}))

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
    getChannels: () => mockActiveChannels,
    realtime: { setAuth: mockSetAuth, disconnect: jest.fn() },
  }),
}))

function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ProjectsProvider>{children}</ProjectsProvider>
    </AuthProvider>
  )
}

function Consumer() {
  const data = useProjectsData()
  return (
    <div>
      <span data-testid="projects-loading">{String(data.projectsLoading)}</span>
      <span data-testid="project-ids">{data.projects.map((project) => project.id).join(',')}</span>
    </div>
  )
}

function MutationConsumer() {
  const data = useProjectsData()
  return (
    <div>
      <span data-testid="mutation-project-ids">
        {data.projects.map((project) => project.id).join(',')}
      </span>
      <button type="button" onClick={() => data.mutateProjects(() => [])}>
        Remove locally
      </button>
      <button
        type="button"
        onClick={() => { void data.refetchProjects().catch(() => undefined) }}
      >
        Refetch
      </button>
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
    mockActiveChannels.length = 0
    resetAuthKitState()
    mockCurrentAppUserId = null
    mockRpc.mockImplementation(async (name: string) =>
      name === 'current_user_id'
        ? { data: mockCurrentAppUserId, error: null }
        : { data: null, error: null }
    )
    mockChannel.mockImplementation((topic: string) => {
      const realtimeTopic = `realtime:${topic}`
      const existing = mockActiveChannels.find((candidate) => candidate.topic === realtimeTopic)
      if (existing) return existing

      let channel: FakeChannel
      channel = {
        topic: realtimeTopic,
        on: jest.fn(() => channel),
        subscribe: jest.fn(() => channel),
      }
      mockActiveChannels.push(channel)
      return channel
    })
    mockRemoveChannel.mockImplementation(async (channel: FakeChannel) => {
      const index = mockActiveChannels.indexOf(channel)
      if (index !== -1) mockActiveChannels.splice(index, 1)
      return 'ok'
    })
  })

  test('opens one channel per table plus one private delete-invalidation channel', async () => {
    signInAs('user-a')

    render(
      <AppProviders>
        <Consumer />
        <Consumer />
      </AppProviders>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    expect(mockRpc.mock.calls.filter(([name]) => name === 'current_user_id')).toHaveLength(1)
    expect(mockChannel.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^projects-changes:user_id=eq\.user-a:/),
        expect.stringMatching(/^transcripts-changes:user_id=eq\.user-a:/),
        'projects-v1:user-a',
      ])
    )
    expect(mockSetAuth).toHaveBeenCalledTimes(2)
    expect(mockSetAuth).toHaveBeenNthCalledWith(1, accessTokenFor('workos-user-a'))
    expect(mockSetAuth).toHaveBeenNthCalledWith(2)
    expect(mockChannel).toHaveBeenCalledWith('projects-v1:user-a', {
      config: { private: true },
    })
  })

  test('waits for same-topic removal before installing a fresh A lifecycle', async () => {
    const delayedRemoval = deferred<'ok' | 'timed out'>()
    let firstA: FakeChannel | undefined
    mockRemoveChannel.mockImplementation((channel: FakeChannel) => {
      const remove = (result: 'ok' | 'timed out') => {
        const index = mockActiveChannels.indexOf(channel)
        if (index !== -1) mockActiveChannels.splice(index, 1)
        return result
      }
      if (channel === firstA) return delayedRemoval.promise.then(remove)
      return Promise.resolve(remove('ok'))
    })
    const refetchProjects = jest.fn().mockResolvedValue(undefined)
    const refetchTranscripts = jest.fn().mockResolvedValue(undefined)
    const { rerender, unmount } = renderHook(
      ({ userId }: { userId: string }) =>
        useProjectsDeleteInvalidation(userId, refetchProjects, refetchTranscripts),
      { initialProps: { userId: 'user-a' } }
    )

    await waitFor(() => {
      expect(mockActiveChannels.some((channel) => channel.topic === 'realtime:projects-v1:user-a')).toBe(true)
    })
    firstA = mockActiveChannels.find(
      (channel) => channel.topic === 'realtime:projects-v1:user-a'
    )
    rerender({ userId: 'user-b' })
    await waitFor(() => {
      expect(mockActiveChannels.some((channel) => channel.topic === 'realtime:projects-v1:user-b')).toBe(true)
    })
    rerender({ userId: 'user-a' })

    await waitFor(() => expect(mockRemoveChannel).toHaveBeenCalledWith(firstA))
    expect(
      mockChannel.mock.calls.filter(([topic]) => topic === 'projects-v1:user-a')
    ).toHaveLength(1)

    await act(async () => {
      delayedRemoval.resolve('timed out')
      await delayedRemoval.promise
    })

    await waitFor(() => {
      expect(
        mockChannel.mock.calls.filter(([topic]) => topic === 'projects-v1:user-a')
      ).toHaveLength(2)
    })
    const secondA = mockActiveChannels.find(
      (channel) => channel.topic === 'realtime:projects-v1:user-a'
    )
    expect(secondA).toBeDefined()
    expect(secondA).not.toBe(firstA)
    unmount()
    await waitFor(() => expect(mockActiveChannels).toHaveLength(0))
  })

  test('does not reuse a same-topic channel left listed after a removal error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockRemoveChannel.mockResolvedValue('error')
    const refetchProjects = jest.fn().mockResolvedValue(undefined)
    const refetchTranscripts = jest.fn().mockResolvedValue(undefined)

    try {
      const first = renderHook(() =>
        useProjectsDeleteInvalidation('user-a', refetchProjects, refetchTranscripts)
      )
      await waitFor(() => {
        expect(mockChannel).toHaveBeenCalledWith('projects-v1:user-a', {
          config: { private: true },
        })
      })
      const staleChannel = mockActiveChannels[0]
      first.unmount()
      await waitFor(() => expect(mockRemoveChannel).toHaveBeenCalledWith(staleChannel))

      renderHook(() =>
        useProjectsDeleteInvalidation('user-a', refetchProjects, refetchTranscripts)
      )
      await waitFor(() => expect(mockSetAuth).toHaveBeenCalledTimes(2))

      expect(
        mockChannel.mock.calls.filter(([topic]) => topic === 'projects-v1:user-a')
      ).toHaveLength(1)
      expect(staleChannel.subscribe).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('owns exactly one private channel through Strict Mode effect replay', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    )
    const refetchProjects = jest.fn().mockResolvedValue(undefined)
    const refetchTranscripts = jest.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(
      () => useProjectsDeleteInvalidation('user-a', refetchProjects, refetchTranscripts),
      { wrapper }
    )

    await waitFor(() => {
      expect(
        mockActiveChannels.filter((channel) => channel.topic === 'realtime:projects-v1:user-a')
      ).toHaveLength(1)
    })
    expect(
      mockChannel.mock.calls.filter(([topic]) => topic === 'projects-v1:user-a')
    ).toHaveLength(1)

    unmount()
    await waitFor(() => expect(mockActiveChannels).toHaveLength(0))
  })

  test('does not remount app content when auth resolves', async () => {
    signInAs('user-a')
    const onMount = jest.fn()

    function MountProbe() {
      React.useEffect(() => {
        onMount()
      }, [])
      return null
    }

    render(
      <AppProviders>
        <MountProbe />
        <Consumer />
      </AppProviders>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    expect(onMount).toHaveBeenCalledTimes(1)
  })

  test('does not fetch or open channels while signed out', async () => {
    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
    )

    await waitFor(() => {
      expect(screen.getByTestId('projects-loading')).toHaveTextContent('false')
    })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockFetchProjects).not.toHaveBeenCalled()
    expect(mockFetchTranscripts).not.toHaveBeenCalled()
    expect(mockChannel).not.toHaveBeenCalled()
  })

  test('never loads the next account’s data when another tab switches accounts', async () => {
    signInAs('user-a')
    mockFetchProjects.mockResolvedValue([project('project-a', 'user-a')])

    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
    )

    await waitFor(() => {
      expect(screen.getByTestId('project-ids')).toHaveTextContent('project-a')
    })

    const fetches = mockFetchProjects.mock.calls.length
    mockFetchProjects.mockResolvedValue([project('project-b', 'user-b')])
    await act(async () => {
      signInAs('user-b')
    })

    // The page stopped as A (AccountChangedScreen covers it): B is never fetched.
    await act(async () => {})
    expect(mockFetchProjects).toHaveBeenCalledTimes(fetches)
    expect(screen.getByTestId('project-ids')).not.toHaveTextContent('project-b')
  })

  test('derived project lists follow a realtime move in the shared transcript list', async () => {
    signInAs('user-a')
    const transcript = transcriptSummary({ project_id: PROJECT_A })
    mockFetchTranscripts.mockResolvedValue([transcript])

    function ProjectTranscripts({ projectId }: { projectId: string }) {
      const { transcripts } = useTranscriptsData()
      return (
        <span data-testid={projectId}>
          {transcriptsInProject(transcripts, projectId)
            .map((item) => item.id)
            .join(',')}
        </span>
      )
    }

    render(
      <AppProviders>
        <ProjectTranscripts projectId={PROJECT_A} />
        <ProjectTranscripts projectId={PROJECT_B} />
      </AppProviders>
    )

    await waitFor(() => {
      expect(screen.getByTestId(PROJECT_A)).toHaveTextContent(TRANSCRIPT_A)
    })

    const transcriptChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('transcripts-changes:')
    )
    const transcriptChannel = mockChannel.mock.results[transcriptChannelIndex].value
    const onChange = transcriptChannel.on.mock.calls[0][2]

    act(() => {
      onChange({ eventType: 'UPDATE', new: { ...transcript, project_id: PROJECT_B } })
    })

    expect(screen.getByTestId(PROJECT_A)).toBeEmptyDOMElement()
    expect(screen.getByTestId(PROJECT_B)).toHaveTextContent(TRANSCRIPT_A)
  })

  test('refetches only the table named by a private delete invalidation', async () => {
    signInAs('user-a')

    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
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

  test('does not let a pre-delete snapshot restore rows after delete invalidation', async () => {
    const preDeleteFetch = deferred<Project[]>()
    const postDeleteFetch = deferred<Project[]>()
    signInAs('user-a')
    mockFetchProjects
      .mockReset()
      .mockReturnValueOnce(preDeleteFetch.promise)
      .mockReturnValueOnce(postDeleteFetch.promise)

    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
    )

    await waitFor(() => expect(mockChannel).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(1))
    const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
      ([name]) => name === 'projects-v1:user-a'
    )
    const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
    const onDelete = invalidationChannel.on.mock.calls[0][2]

    act(() => onDelete({ payload: { table: 'projects' } }))
    expect(mockFetchProjects).toHaveBeenCalledTimes(1)

    await act(async () => {
      preDeleteFetch.resolve([project('deleted-project', 'user-a')])
      await preDeleteFetch.promise
    })
    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('project-ids')).toBeEmptyDOMElement()

    await act(async () => {
      postDeleteFetch.resolve([])
      await postDeleteFetch.promise
    })
    expect(screen.getByTestId('project-ids')).toBeEmptyDOMElement()
  })

  test('provider-exposed mutation invalidates an already-running snapshot', async () => {
    jest.useFakeTimers()
    const staleFetch = deferred<Project[]>()
    const reconciliation = deferred<Project[]>()
    signInAs('user-a')
    mockFetchProjects.mockResolvedValueOnce([project('project-a', 'user-a')])

    const { unmount } = render(
      <AppProviders>
        <MutationConsumer />
      </AppProviders>
    )

    try {
      await waitFor(() => {
        expect(screen.getByTestId('mutation-project-ids')).toHaveTextContent('project-a')
      })
      mockFetchProjects
        .mockReset()
        .mockReturnValueOnce(staleFetch.promise)
        .mockReturnValueOnce(reconciliation.promise)

      act(() => screen.getByRole('button', { name: 'Refetch' }).click())
      expect(mockFetchProjects).toHaveBeenCalledTimes(1)
      act(() => screen.getByRole('button', { name: 'Remove locally' }).click())
      expect(screen.getByTestId('mutation-project-ids')).toBeEmptyDOMElement()

      await act(async () => {
        staleFetch.resolve([project('project-a', 'user-a')])
        await staleFetch.promise
      })
      expect(screen.getByTestId('mutation-project-ids')).toBeEmptyDOMElement()

      await act(async () => {
        jest.advanceTimersByTime(250)
        await Promise.resolve()
      })
      expect(mockFetchProjects).toHaveBeenCalledTimes(2)

      await act(async () => {
        reconciliation.resolve([])
        await reconciliation.promise
      })
      expect(screen.getByTestId('mutation-project-ids')).toBeEmptyDOMElement()
    } finally {
      unmount()
      jest.useRealTimers()
    }
  })

  test('coalesces a burst into one in-flight and one trailing refetch per table', async () => {
    signInAs('user-a')

    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
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

  test('retries real delete reconciliation failures with bounded backoff', async () => {
    jest.useFakeTimers()
    const failure = new Error('temporary failure')
    const refetchProjects = jest.fn().mockRejectedValue(failure)
    const refetchTranscripts = jest.fn().mockResolvedValue(undefined)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { unmount } = renderHook(() =>
      useProjectsDeleteInvalidation('user-a', refetchProjects, refetchTranscripts)
    )

    try {
      await act(async () => {
        await Promise.resolve()
      })
      const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
        ([name]) => name === 'projects-v1:user-a'
      )
      const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value
      const onDelete = invalidationChannel.on.mock.calls[0][2]

      act(() => onDelete({ payload: { table: 'projects' } }))
      await act(async () => {
        await Promise.resolve()
      })
      expect(refetchProjects).toHaveBeenCalledTimes(1)

      for (const delay of [250, 500, 1000]) {
        await act(async () => {
          jest.advanceTimersByTime(delay)
          await Promise.resolve()
          await Promise.resolve()
        })
      }

      expect(refetchProjects).toHaveBeenCalledTimes(4)
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
      errorSpy.mockRestore()
      jest.useRealTimers()
    }
  })

  test('treats scope cancellation as a quiet end to delete reconciliation', async () => {
    jest.useFakeTimers()
    const refetchProjects = jest.fn().mockRejectedValue(new RealtimeScopeAbortError())
    const refetchTranscripts = jest.fn().mockResolvedValue(undefined)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { unmount } = renderHook(() =>
      useProjectsDeleteInvalidation('user-a', refetchProjects, refetchTranscripts)
    )

    try {
      await act(async () => {
        await Promise.resolve()
      })
      const invalidationChannelIndex = mockChannel.mock.calls.findIndex(
        ([name]) => name === 'projects-v1:user-a'
      )
      const invalidationChannel = mockChannel.mock.results[invalidationChannelIndex].value

      act(() => invalidationChannel.on.mock.calls[0][2]({ payload: { table: 'projects' } }))
      await act(async () => {
        await Promise.resolve()
        jest.advanceTimersByTime(5000)
      })

      expect(refetchProjects).toHaveBeenCalledTimes(1)
      expect(
        errorSpy.mock.calls.filter(([message]) => String(message).startsWith('[projects]'))
      ).toHaveLength(0)
    } finally {
      unmount()
      errorSpy.mockRestore()
      jest.useRealTimers()
    }
  })

  test('refetches both tables on initial subscribe and reconnect', async () => {
    signInAs('user-a')

    render(
      <AppProviders>
        <Consumer />
      </AppProviders>
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

  test('isolates project and transcript consumers while mixed consumers follow both', async () => {
    signInAs('user-a')
    mockFetchProjects.mockResolvedValue([project('project-a', 'user-a')])
    mockFetchTranscripts.mockResolvedValue([transcriptSummary()])
    const projectRenders: number[] = []
    const transcriptRenders: number[] = []
    const mixedRenders: number[] = []

    function ProjectOnly() {
      const { projects } = useProjectsData()
      React.useEffect(() => { projectRenders.push(projects.length) })
      return <span data-testid="isolated-project">{projects[0]?.name}</span>
    }

    function TranscriptOnly() {
      const { transcripts } = useTranscriptsData()
      React.useEffect(() => { transcriptRenders.push(transcripts.length) })
      return <span data-testid="isolated-transcript">{transcripts[0]?.id}</span>
    }

    function Mixed() {
      const { projects } = useProjectsData()
      const { transcripts } = useTranscriptsData()
      React.useEffect(() => { mixedRenders.push(projects.length + transcripts.length) })
      return <span>{projects.length + transcripts.length}</span>
    }

    const view = render(
      <AppProviders>
        <ProjectOnly />
        <TranscriptOnly />
        <Mixed />
      </AppProviders>
    )
    await waitFor(() => expect(screen.getByTestId('isolated-project')).toHaveTextContent('project-a'))
    await waitFor(() => expect(screen.getByTestId('isolated-transcript')).toHaveTextContent(TRANSCRIPT_A))
    const projectChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('projects-changes:')
    )
    const transcriptChannelIndex = mockChannel.mock.calls.findIndex(([name]) =>
      String(name).startsWith('transcripts-changes:')
    )
    const projectChannel = mockChannel.mock.results[projectChannelIndex].value
    const transcriptChannel = mockChannel.mock.results[transcriptChannelIndex].value

    jest.useFakeTimers()
    try {
      const beforeProject = {
        projectRenders: projectRenders.length,
        transcriptRenders: transcriptRenders.length,
        mixedRenders: mixedRenders.length,
      }
      act(() => {
        projectChannel.on.mock.calls[0][2]({
          eventType: 'UPDATE',
          new: { ...project('project-a', 'user-a'), name: 'Updated project' },
        })
      })
      expect(projectRenders.length - beforeProject.projectRenders).toBe(1)
      expect(transcriptRenders.length - beforeProject.transcriptRenders).toBe(0)
      expect(mixedRenders.length - beforeProject.mixedRenders).toBe(1)

      const beforeTranscript = {
        projectRenders: projectRenders.length,
        transcriptRenders: transcriptRenders.length,
        mixedRenders: mixedRenders.length,
      }
      act(() => {
        transcriptChannel.on.mock.calls[0][2]({
          eventType: 'UPDATE',
          new: { ...transcriptSummary({ title: 'Updated transcript' }), user_id: 'user-a' },
        })
      })
      expect(projectRenders.length - beforeTranscript.projectRenders).toBe(0)
      expect(transcriptRenders.length - beforeTranscript.transcriptRenders).toBe(1)
      expect(mixedRenders.length - beforeTranscript.mixedRenders).toBe(1)
    } finally {
      view.unmount()
      jest.useRealTimers()
    }
  })

  test('profiles realistic initial, reconciliation, realtime, and polling traffic', async () => {
    signInAs('user-a')
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
      engine: 'deepgram',
      engine_model: null,
      language: 'en',
      detect_speakers: true,
      keep_filler_words: true,
      mask_profanity: false,
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
      const data = useTranscriptsData()
      return <span data-testid="large-transcript-count">{data.transcripts.length}</span>
    }

    const { unmount } = render(
      <AppProviders>
        <React.Profiler id="large-projects" onRender={(_id, _phase, duration) => projectCommits.push(duration)}>
          <LargeProjectConsumer />
        </React.Profiler>
        <React.Profiler id="large-transcripts" onRender={(_id, _phase, duration) => transcriptCommits.push(duration)}>
          <LargeTranscriptConsumer />
        </React.Profiler>
      </AppProviders>
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
