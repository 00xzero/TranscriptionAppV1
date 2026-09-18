import { act, renderHook, waitFor } from '@testing-library/react'
import {
  useAuthIdentity,
  useProjectsRealtime,
  useSpeakersRealtime,
  useTranscriptJobsRealtime,
  useTranscriptRealtime,
  useTranscriptsRealtime,
} from '@/lib/supabase/hooks'
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
const mockFetchTranscriptById = jest.fn()
const mockFetchTranscriptJobs = jest.fn()
const mockFetchSpeakers = jest.fn()
let authStateHandler:
  | ((event: string, session: { user: { id: string } } | null) => void)
  | null = null

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
  fetchTranscriptById: (...args: unknown[]) => mockFetchTranscriptById(...args),
  fetchTranscriptJobs: (...args: unknown[]) => mockFetchTranscriptJobs(...args),
  fetchSpeakers: (...args: unknown[]) => mockFetchSpeakers(...args),
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAuthIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authStateHandler = null
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-from-session' } } },
    })
    mockOnAuthStateChange.mockImplementation((handler) => {
      authStateHandler = handler
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
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

  test.each([
    ['sign-out', 'SIGNED_OUT', null, null],
    ['account switch', 'SIGNED_IN', { user: { id: 'user-b' } }, 'user-b'],
  ])(
    'ignores stale verification after an auth %s',
    async (_label, event, session, expectedUserId) => {
      const verified = deferred<{
        data: { user: { id: string } | null }
        error: Error | null
      }>()
      mockGetUser.mockReturnValueOnce(verified.promise)

      const { result } = renderHook(() => useAuthIdentity())

      await waitFor(() => expect(result.current.userId).toBe('user-from-session'))
      act(() => {
        authStateHandler?.(event, session)
      })
      expect(result.current).toEqual({ userId: expectedUserId, ready: true })

      await act(async () => {
        verified.resolve({
          data: { user: { id: 'user-from-session' } },
          error: null,
        })
        await verified.promise
      })

      expect(result.current).toEqual({ userId: expectedUserId, ready: true })
    }
  )
})

describe('useTranscriptsRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchTranscripts.mockResolvedValue([])
    mockMoveTranscript.mockResolvedValue(undefined)
    mockAddTranscripts.mockImplementation(async (ids: string[]) => ({ addedIds: ids, missingIds: [] }))
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
      expect.stringMatching(/^transcripts-changes:user_id=eq\.user-from-session:[^:]+:\d+$/)
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

    expect(firstTopic).toMatch(/^transcripts-changes:user_id=eq\.user-from-session:[^:]+:\d+$/)
    expect(secondTopic).toMatch(/^transcripts-changes:user_id=eq\.user-from-session:[^:]+:\d+$/)
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
    mockFetchTranscripts.mockResolvedValue([])

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

  test('logs a non-cancellation failure from delete recovery reconciliation', async () => {
    const deleteError = new Error('delete response lost')
    const reconciliationError = new Error('reconciliation unavailable')
    mockDeleteTranscript.mockRejectedValueOnce(deleteError)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    try {
      await waitFor(() => expect(hook.current.isLoading).toBe(false))
      mockFetchTranscripts.mockRejectedValueOnce(reconciliationError)

      await act(async () => {
        await expect(hook.current.deleteTranscript('missing-transcript')).rejects.toBe(deleteError)
      })

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[realtime] Failed to reconcile after transcript deletion failure:',
          reconciliationError
        )
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('keeps concurrent realtime changes when rolling back a failed delete', async () => {
    const oldest = { id: 'transcript-0', created_at: '2026-03-01T12:00:00Z' }
    const deleted = { id: 'transcript-1', created_at: '2026-04-01T12:00:00Z' }
    const inserted = { id: 'transcript-2', created_at: '2026-04-02T12:00:00Z' }
    mockFetchTranscripts
      .mockResolvedValueOnce([deleted, oldest])
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

  test('does not reconcile an optimistic move before the write settles', async () => {
    jest.useFakeTimers()
    const transcript = { id: 'transcript-1', project_id: 'project-a' }
    const moved = { ...transcript, project_id: 'project-b' }
    const request = deferred<void>()
    mockFetchTranscripts.mockResolvedValue([transcript])
    mockMoveTranscript.mockReturnValueOnce(request.promise)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(hook.current.transcripts).toEqual([transcript])
    const fetchCallsBeforeMove = mockFetchTranscripts.mock.calls.length

    let move!: Promise<void>
    act(() => {
      move = hook.current.moveTranscript('transcript-1', 'project-b')
    })
    expect(hook.current.transcripts).toEqual([moved])

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeMove)
    expect(hook.current.transcripts).toEqual([moved])

    mockFetchTranscripts.mockResolvedValue([moved])
    await act(async () => {
      request.resolve()
      await move
    })
    await waitFor(() => {
      expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeMove + 1)
      expect(hook.current.transcripts).toEqual([moved])
    })
    jest.useRealTimers()
  })

  test('adds transcripts in one optimistic batch and keeps the update on success', async () => {
    const first = { id: 'transcript-1', project_id: null }
    const second = { id: 'transcript-2', project_id: 'project-a' }
    mockFetchTranscripts.mockResolvedValue([first, second])
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(hook.current.transcripts).toEqual([first, second]))
    mockFetchTranscripts.mockResolvedValue([
      { ...first, project_id: 'project-b' },
      { ...second, project_id: 'project-b' },
    ])

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

  test('keeps added transcripts, drops ones the batched add could not find, and reconciles', async () => {
    const first = { id: 'transcript-1', project_id: null }
    const gone = { id: 'transcript-2', project_id: null }
    const result = { addedIds: ['transcript-1'], missingIds: ['transcript-2'] }
    mockFetchTranscripts.mockResolvedValue([first, gone])
    mockAddTranscripts.mockResolvedValueOnce(result)
    const { result: hook } = renderHook(() =>
      useTranscriptsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(hook.current.transcripts).toEqual([first, gone]))
    // The reconciling refetch never settles, so only the local update can drop the row.
    mockFetchTranscripts.mockReturnValue(new Promise(() => undefined))
    const fetchCallsBeforeAdd = mockFetchTranscripts.mock.calls.length

    await act(async () => {
      await expect(
        hook.current.addTranscripts(['transcript-1', 'transcript-2'], 'project-b')
      ).resolves.toEqual(result)
    })

    expect(hook.current.transcripts).toEqual([{ ...first, project_id: 'project-b' }])
    expect(mockFetchTranscripts).toHaveBeenCalledTimes(fetchCallsBeforeAdd + 1)
  })
})

describe('editor realtime hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    makeChannel()
    mockFetchTranscriptById.mockImplementation(async (id: string) => ({ id, title: id }))
    mockFetchTranscriptJobs.mockResolvedValue([])
    mockFetchSpeakers.mockImplementation(async (id: string) => [{ id: `speaker-${id}` }])
  })

  test('useTranscriptRealtime hides the previous id synchronously and uses the new id', async () => {
    const { result, rerender } = renderHook(
      ({ transcriptId }: { transcriptId: string }) => useTranscriptRealtime(transcriptId),
      { initialProps: { transcriptId: 'transcript-a' } }
    )

    await waitFor(() => expect(result.current.transcript?.id).toBe('transcript-a'))
    rerender({ transcriptId: 'transcript-b' })
    expect(result.current.transcript).toBeNull()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.transcript?.id).toBe('transcript-b'))
    expect(mockFetchTranscriptById).toHaveBeenLastCalledWith('transcript-b')
  })

  test('useTranscriptJobsRealtime retains its payload transform without channel churn', async () => {
    const { result, rerender } = renderHook(
      ({ transcriptId }: { transcriptId: string }) => useTranscriptJobsRealtime(transcriptId),
      { initialProps: { transcriptId: 'transcript-a' } }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const channelsBefore = mockChannelFactory.mock.calls.length
    const onChange = channelMock.on.mock.calls[0][2] as (payload: unknown) => void
    act(() => {
      onChange({
        eventType: 'INSERT',
        new: { id: 'job-a', status: 'processing', payload: { very: 'large' } },
      })
    })

    expect(result.current.jobs).toEqual([{ id: 'job-a', status: 'processing' }])
    rerender({ transcriptId: 'transcript-a' })
    expect(mockChannelFactory).toHaveBeenCalledTimes(channelsBefore)
  })

  test('useSpeakersRealtime resets cleanly when its transcript id changes', async () => {
    const { result, rerender } = renderHook(
      ({ transcriptId }: { transcriptId: string }) => useSpeakersRealtime(transcriptId),
      { initialProps: { transcriptId: 'transcript-a' } }
    )

    await waitFor(() => expect(result.current.speakers).toEqual([{ id: 'speaker-transcript-a' }]))
    rerender({ transcriptId: 'transcript-b' })
    expect(result.current.speakers).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.speakers).toEqual([{ id: 'speaker-transcript-b' }]))
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
    expect(mockCreateProject).toHaveBeenCalledWith({
      name: 'New',
      parent_id: null,
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

  test('does not let an older rename success overwrite a newer rename', async () => {
    const firstRequest = deferred<Project>()
    const secondRequest = deferred<Project>()
    mockRenameProject
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
    const { result } = renderHook(() =>
      useProjectsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(result.current.projects).toEqual([existing]))

    let firstRename!: Promise<Project>
    act(() => {
      firstRename = result.current.renameProject(existing.id, 'First')
    })
    let secondRename!: Promise<Project>
    act(() => {
      secondRename = result.current.renameProject(existing.id, 'Second')
    })

    const secondProject = { ...existing, name: 'Second' }
    await act(async () => {
      secondRequest.resolve(secondProject)
      await expect(secondRename).resolves.toEqual(secondProject)
    })
    expect(result.current.projects).toEqual([secondProject])

    const firstProject = { ...existing, name: 'First' }
    await act(async () => {
      firstRequest.resolve(firstProject)
      await expect(firstRename).resolves.toEqual(firstProject)
    })
    expect(result.current.projects).toEqual([secondProject])
  })

  test('does not roll back or refetch for an older failed rename', async () => {
    const firstRequest = deferred<Project>()
    const secondRequest = deferred<Project>()
    mockRenameProject
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)
    const { result } = renderHook(() =>
      useProjectsRealtime({ userId: 'user-from-session' })
    )

    await waitFor(() => expect(result.current.projects).toEqual([existing]))
    const fetchCallsBeforeRename = mockFetchProjects.mock.calls.length

    let firstRename!: Promise<Project>
    act(() => {
      firstRename = result.current.renameProject(existing.id, 'First')
    })
    let secondRename!: Promise<Project>
    act(() => {
      secondRename = result.current.renameProject(existing.id, 'Second')
    })

    const secondProject = { ...existing, name: 'Second' }
    await act(async () => {
      secondRequest.resolve(secondProject)
      await expect(secondRename).resolves.toEqual(secondProject)
    })

    const firstError = new Error('first rename failed')
    await act(async () => {
      firstRequest.reject(firstError)
      await expect(firstRename).rejects.toBe(firstError)
    })

    expect(result.current.projects).toEqual([secondProject])
    expect(mockFetchProjects).toHaveBeenCalledTimes(fetchCallsBeforeRename)
  })
})
