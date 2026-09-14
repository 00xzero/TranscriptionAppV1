import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuthIdentity, useProjectsRealtime, useTranscriptsRealtime } from '@/lib/supabase/hooks'
import type { Project } from '@/contracts/db'

const mockFetchTranscripts = jest.fn()
const mockGetSession = jest.fn()
const mockGetUser = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockUnsubscribe = jest.fn()
const mockRemoveChannel = jest.fn()
const mockChannelFactory = jest.fn()
const mockDeleteTranscript = jest.fn()
const mockMoveTranscript = jest.fn()
const mockAddTranscripts = jest.fn()
const mockFetchProjects = jest.fn()
const mockCreateProject = jest.fn()
const mockRenameProject = jest.fn()

let channelMock: {
  on: jest.Mock
  subscribe: jest.Mock
}

jest.mock('@/lib/supabase/queries', () => ({
  fetchTranscripts: () => mockFetchTranscripts(),
  deleteTranscript: (...args: unknown[]) => mockDeleteTranscript(...args),
  moveTranscriptToProject: (...args: unknown[]) => mockMoveTranscript(...args),
  addTranscriptsToProject: (...args: unknown[]) => mockAddTranscripts(...args),
  fetchProjects: () => mockFetchProjects(),
  createProject: (...args: unknown[]) => mockCreateProject(...args),
  renameProject: (...args: unknown[]) => mockRenameProject(...args),
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
    channel: mockChannelFactory,
    removeChannel: mockRemoveChannel,
  }),
}))

function makeChannel() {
  channelMock = {
    on: jest.fn(() => channelMock),
    subscribe: jest.fn((callback) => {
      callback('SUBSCRIBED')
      return channelMock
    }),
  }
  mockChannelFactory.mockReturnValue(channelMock)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useAuthIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-from-session' } } },
    })
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })
    makeChannel()
  })

  test('exposes the cached user id without marking identity ready before verification', async () => {
    const verified = deferred<{
      data: { user: { id: string } | null }
      error: Error | null
    }>()
    mockGetUser.mockReturnValueOnce(verified.promise)

    const { result } = renderHook(() => useAuthIdentity())

    await waitFor(() => {
      expect(result.current.userId).toBe('user-from-session')
    })
    expect(result.current.ready).toBe(false)

    await act(async () => {
      verified.resolve({
        data: { user: { id: 'verified-user' } },
        error: null,
      })
      await verified.promise
    })

    await waitFor(() => {
      expect(result.current).toEqual({
        userId: 'verified-user',
        ready: true,
      })
    })
  })

  test('keeps the cached user id but does not mark identity ready when verification fails', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('invalid session'),
    })

    const { result } = renderHook(() => useAuthIdentity())

    await waitFor(() => {
      expect(result.current.userId).toBe('user-from-session')
    })
    expect(result.current.ready).toBe(false)
  })

  test('settles as signed out without verifying a session that does not exist', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })

    const { result } = renderHook(() => useAuthIdentity())

    await waitFor(() => {
      expect(result.current).toEqual({ userId: null, ready: true })
    })
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})

describe('useTranscriptsRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchTranscripts.mockResolvedValue([])
    mockMoveTranscript.mockResolvedValue(undefined)
    mockAddTranscripts.mockResolvedValue(undefined)
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-from-session' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })
    makeChannel()
  })

  test('opens the filtered realtime channel from the browser session before getUser resolves', async () => {
    const { result } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected')
    })

    expect(mockChannelFactory).toHaveBeenCalledWith(
      expect.stringMatching(/^transcripts-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    )
    expect(channelMock.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        table: 'transcripts',
        filter: 'user_id=eq.user-from-session',
      }),
      expect.any(Function)
    )
  })

  test('uses separate channel topics for overlapping transcripts subscriptions', async () => {
    renderHook(() => useTranscriptsRealtime({ userId: 'user-from-session' }))
    renderHook(() => useTranscriptsRealtime({ userId: 'user-from-session' }))

    await waitFor(() => {
      expect(mockChannelFactory).toHaveBeenCalledTimes(2)
    })

    const firstTopic = mockChannelFactory.mock.calls[0][0]
    const secondTopic = mockChannelFactory.mock.calls[1][0]

    expect(firstTopic).toMatch(/^transcripts-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    expect(secondTopic).toMatch(/^transcripts-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    expect(firstTopic).not.toBe(secondTopic)
  })

  test('keeps the optimistic removal and returns pending cleanup keys', async () => {
    const result = { cleanupPendingKeys: ['user/transcript/waveform.json'] }
    mockFetchTranscripts.mockResolvedValue([{ id: 'transcript-1' }])
    mockDeleteTranscript.mockResolvedValueOnce(result)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => {
      expect(hook.current.transcripts).toEqual([{ id: 'transcript-1' }])
    })

    await act(async () => {
      await expect(hook.current.deleteTranscript('transcript-1')).resolves.toEqual(result)
    })

    expect(hook.current.transcripts).toEqual([])
  })

  test('restores the removed transcript locally when the delete fails', async () => {
    const error = new Error('row delete denied')
    const transcript = { id: 'transcript-1', created_at: '2026-04-01T12:00:00Z' }
    // The reconciling refetch never settles, so only the local rollback can restore the row.
    mockFetchTranscripts
      .mockResolvedValueOnce([transcript])
      .mockReturnValue(new Promise(() => undefined))
    mockDeleteTranscript.mockRejectedValueOnce(error)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => {
      expect(hook.current.transcripts).toEqual([transcript])
    })
    const fetchCallsBeforeDelete = mockFetchTranscripts.mock.calls.length

    await act(async () => {
      await expect(hook.current.deleteTranscript('transcript-1')).rejects.toBe(error)
    })

    expect(hook.current.transcripts).toEqual([transcript])
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeDelete + 1)
  })

  test('keeps concurrent realtime changes when rolling back a failed delete', async () => {
    const oldest = { id: 'transcript-0', created_at: '2026-03-01T12:00:00Z' }
    const deleted = { id: 'transcript-1', created_at: '2026-04-01T12:00:00Z' }
    const inserted = { id: 'transcript-2', created_at: '2026-04-02T12:00:00Z' }
    mockFetchTranscripts
      .mockResolvedValueOnce([deleted, oldest])
      .mockReturnValue(new Promise(() => undefined))
    let rejectDelete!: (reason: unknown) => void
    mockDeleteTranscript.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectDelete = reject
      })
    )
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => {
      expect(hook.current.transcripts).toEqual([deleted, oldest])
      expect(hook.current.connectionStatus).toBe('connected')
    })
    const onChange = channelMock.on.mock.calls[0][2] as (payload: unknown) => void

    let deletion!: Promise<unknown>
    act(() => {
      deletion = hook.current.deleteTranscript(deleted.id)
    })
    expect(hook.current.transcripts).toEqual([oldest])

    act(() => {
      onChange({ eventType: 'INSERT', new: inserted })
    })

    await act(async () => {
      rejectDelete(new Error('row delete denied'))
      await expect(deletion).rejects.toThrow('row delete denied')
    })

    expect(hook.current.transcripts).toEqual([inserted, deleted, oldest])
  })

  test('moves a transcript optimistically and rolls back a failed move', async () => {
    const transcript = { id: 'transcript-1', project_id: 'project-a' }
    mockFetchTranscripts.mockResolvedValue([transcript])
    const error = new Error('move denied')
    mockMoveTranscript.mockRejectedValueOnce(error)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(hook.current.transcripts).toEqual([transcript]))
    const fetchCallsBeforeMove = mockFetchTranscripts.mock.calls.length

    await act(async () => {
      await expect(hook.current.moveTranscript('transcript-1', 'project-b')).rejects.toBe(error)
    })

    expect(mockMoveTranscript).toHaveBeenCalledWith('transcript-1', 'project-b')
    expect(hook.current.transcripts).toEqual([transcript])
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeMove + 1)
  })

  test('adds transcripts in one optimistic batch and keeps the update on success', async () => {
    const first = { id: 'transcript-1', project_id: null }
    const second = { id: 'transcript-2', project_id: 'project-a' }
    mockFetchTranscripts.mockResolvedValue([first, second])
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(hook.current.transcripts).toEqual([first, second]))

    await act(async () => {
      await hook.current.addTranscripts(['transcript-1', 'transcript-2'], 'project-b')
    })

    expect(mockAddTranscripts).toHaveBeenCalledWith(
      ['transcript-1', 'transcript-2'],
      'project-b'
    )
    expect(hook.current.transcripts).toEqual([
      { ...first, project_id: 'project-b' },
      { ...second, project_id: 'project-b' },
    ])
  })

  test('rolls every targeted transcript back when a batched add fails', async () => {
    const first = { id: 'transcript-1', project_id: null }
    const second = { id: 'transcript-2', project_id: 'project-a' }
    const error = new Error('batch denied')
    mockFetchTranscripts.mockResolvedValue([first, second])
    mockAddTranscripts.mockRejectedValueOnce(error)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(hook.current.transcripts).toEqual([first, second]))
    const fetchCallsBeforeAdd = mockFetchTranscripts.mock.calls.length

    await act(async () => {
      await expect(
        hook.current.addTranscripts(['transcript-1', 'transcript-2'], 'project-b')
      ).rejects.toBe(error)
    })

    expect(hook.current.transcripts).toEqual([first, second])
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeAdd + 1)
  })
})

describe('useProjectsRealtime', () => {
  const existing = {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-from-session',
    parent_id: null,
    name: 'Existing',
    deleting_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchProjects.mockResolvedValue([existing])
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-from-session' } } },
    })
    mockGetUser.mockReturnValue(new Promise(() => undefined))
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    })
    makeChannel()
  })

  test('adds a temporary project immediately and replaces it with the created row', async () => {
    const created = { ...existing, id: '22222222-2222-4222-8222-222222222222', name: 'New' }
    const request = deferred<Project>()
    mockCreateProject.mockReturnValueOnce(request.promise)
    const { result } = renderHook(() =>
      useProjectsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(result.current.projects).toEqual([existing]))

    let creation!: Promise<Project>
    act(() => {
      creation = result.current.createProject({ name: ' New ', parent_id: null })
    })
    expect(result.current.projects).toHaveLength(2)
    expect(result.current.projects[1]).toEqual(
      expect.objectContaining({ name: 'New', parent_id: null, user_id: 'user-from-session' })
    )

    await act(async () => {
      request.resolve(created)
      await expect(creation).resolves.toEqual(created)
    })
    expect(result.current.projects).toEqual([existing, created])
  })

  test('removes the temporary project when creation fails', async () => {
    const error = new Error('create denied')
    mockCreateProject.mockRejectedValueOnce(error)
    const { result } = renderHook(() =>
      useProjectsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(result.current.projects).toEqual([existing]))
    const fetchCallsBeforeCreate = mockFetchProjects.mock.calls.length

    await act(async () => {
      await expect(
        result.current.createProject({ name: 'New', parent_id: null })
      ).rejects.toBe(error)
    })

    expect(result.current.projects).toEqual([existing])
    expect(mockFetchProjects).toHaveBeenCalledTimes(fetchCallsBeforeCreate + 1)
  })

  test('rolls an optimistic rename back when the query fails', async () => {
    const error = new Error('rename denied')
    mockRenameProject.mockRejectedValueOnce(error)
    const { result } = renderHook(() =>
      useProjectsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(result.current.projects).toEqual([existing]))
    const fetchCallsBeforeRename = mockFetchProjects.mock.calls.length

    await act(async () => {
      await expect(result.current.renameProject(existing.id, 'Changed')).rejects.toBe(error)
    })

    expect(mockRenameProject).toHaveBeenCalledWith(existing.id, 'Changed')
    expect(result.current.projects).toEqual([existing])
    expect(mockFetchProjects).toHaveBeenCalledTimes(fetchCallsBeforeRename + 1)
  })
})
