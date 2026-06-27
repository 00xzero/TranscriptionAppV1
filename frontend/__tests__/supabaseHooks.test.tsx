import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuthIdentity, useProjectsRealtime } from '@/lib/supabase/hooks'

const mockFetchProjects = jest.fn()
const mockGetSession = jest.fn()
const mockGetUser = jest.fn()
const mockOnAuthStateChange = jest.fn()
const mockUnsubscribe = jest.fn()
const mockRemoveChannel = jest.fn()
const mockChannelFactory = jest.fn()

let channelMock: {
  on: jest.Mock
  subscribe: jest.Mock
}

jest.mock('@/lib/supabase/queries', () => ({
  fetchProjects: () => mockFetchProjects(),
  deleteProject: jest.fn(),
  fetchProjectById: jest.fn(),
  fetchProjectJobs: jest.fn(),
  fetchSpeakers: jest.fn(),
  updateProject: jest.fn(),
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
})

describe('useProjectsRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchProjects.mockResolvedValue([])
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
    const { result } = renderHook(() => useProjectsRealtime())

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('connected')
    })

    expect(mockChannelFactory).toHaveBeenCalledWith(
      expect.stringMatching(/^projects-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    )
    expect(channelMock.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        table: 'projects',
        filter: 'user_id=eq.user-from-session',
      }),
      expect.any(Function)
    )
  })

  test('uses separate channel topics for overlapping projects subscriptions', async () => {
    renderHook(() => useProjectsRealtime())
    renderHook(() => useProjectsRealtime())

    await waitFor(() => {
      expect(mockChannelFactory).toHaveBeenCalledTimes(2)
    })

    const firstTopic = mockChannelFactory.mock.calls[0][0]
    const secondTopic = mockChannelFactory.mock.calls[1][0]

    expect(firstTopic).toMatch(/^projects-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    expect(secondTopic).toMatch(/^projects-changes:user_id=eq\.user-from-session:\d+:\d+$/)
    expect(firstTopic).not.toBe(secondTopic)
  })
})
