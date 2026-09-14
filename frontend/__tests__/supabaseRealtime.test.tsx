import { act, renderHook, waitFor } from '@testing-library/react'
import { useSupabaseRealtime } from '@/lib/supabase/realtime'

type Row = {
  id: string
  title: string
}

let changeHandler: ((payload: { eventType: string; new?: Row; old?: Partial<Row> }) => void) | null = null
let statusHandler: ((status: string) => void) | null = null
let statusHandlers: Array<(status: string) => void> = []
let channelMock: {
  on: jest.Mock
  subscribe: jest.Mock
}
const removeChannelMock = jest.fn()
const channelFactoryMock = jest.fn()

jest.mock('@/infra/supabase/client', () => ({
  createClient: () => ({
    channel: channelFactoryMock,
    removeChannel: removeChannelMock,
  }),
}))

function makeChannel() {
  channelFactoryMock.mockImplementation(() => {
    channelMock = {
    on: jest.fn((_event, _filter, callback) => {
      changeHandler = callback
      return channelMock
    }),
    subscribe: jest.fn((callback) => {
      statusHandler = callback
      statusHandlers.push(callback)
      return channelMock
    }),
    }
    return channelMock
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useSupabaseRealtime', () => {
  beforeEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    changeHandler = null
    statusHandler = null
    statusHandlers = []
    makeChannel()
  })

  test('prepends realtime inserts and replaces duplicate rows by id', async () => {
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, {
        insertPosition: 'prepend',
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])
    })

    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'new', title: 'New transcript' } })
    })

    expect(result.current.data).toEqual([
      { id: 'new', title: 'New transcript' },
      { id: 'old', title: 'Old transcript' },
    ])

    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'new', title: 'Updated title' } })
    })

    expect(result.current.data).toEqual([
      { id: 'new', title: 'Updated title' },
      { id: 'old', title: 'Old transcript' },
    ])
  })

  test('retains settled data without returning to loading during a refetch', async () => {
    const refresh = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'old', title: 'Old transcript' }])
      .mockReturnValueOnce(refresh.promise)

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, {
        subscriptionEnabled: false,
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      void result.current.refetch()
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])

    await act(async () => {
      refresh.resolve([{ id: 'new', title: 'New transcript' }])
      await refresh.promise
    })

    expect(result.current.data).toEqual([{ id: 'new', title: 'New transcript' }])
  })

  test('stops polling after realtime connects and performs one resync fetch', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])

    renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, {
        pollingInterval: 5000,
      })
    )

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      statusHandler?.('SUBSCRIBED')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      jest.advanceTimersByTime(10000)
      await Promise.resolve()
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)

    jest.useRealTimers()
  })

  test('reports connecting while subscription inputs are still unavailable', async () => {
    const fetchFn = jest.fn().mockResolvedValue([])

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, {
        subscriptionEnabled: false,
      })
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.connectionStatus).toBe('connecting')
    expect(channelFactoryMock).not.toHaveBeenCalled()
  })

  test('does no work and exposes empty settled data when fully disabled', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, {
        enabled: false,
        initialData: [{ id: 'cached', title: 'Cached transcript' }],
        pollingInterval: 10,
      })
    )

    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.connectionStatus).toBe('disconnected')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(channelFactoryMock).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(100)
      await Promise.resolve()
    })
    expect(fetchFn).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('invalidates an in-flight fetch and starts clean after re-enabling', async () => {
    const staleFetch = deferred<Row[]>()
    const freshFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise)

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, {
          enabled,
          subscriptionEnabled: false,
        }),
      { initialProps: { enabled: true } }
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))

    rerender({ enabled: false })
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.connectionStatus).toBe('disconnected')

    await act(async () => {
      staleFetch.resolve([{ id: 'stale', title: 'Stale transcript' }])
      await staleFetch.promise
    })
    expect(result.current.data).toEqual([])

    rerender({ enabled: true })
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    await act(async () => {
      freshFetch.resolve([{ id: 'fresh', title: 'Fresh transcript' }])
      await freshFetch.promise
    })

    expect(result.current.data).toEqual([{ id: 'fresh', title: 'Fresh transcript' }])
    expect(result.current.isLoading).toBe(false)
  })

  test('retries a channel error instead of parking disconnected', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])

    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      statusHandlers[0]?.('SUBSCRIBED')
      await Promise.resolve()
    })

    expect(result.current.connectionStatus).toBe('connected')

    act(() => {
      statusHandlers[0]?.('CHANNEL_ERROR')
    })

    expect(result.current.connectionStatus).toBe('connecting')

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(channelFactoryMock).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      statusHandlers[1]?.('SUBSCRIBED')
      await Promise.resolve()
    })

    expect(result.current.connectionStatus).toBe('connected')

    jest.useRealTimers()
  })

  test('clears pending retry timer when retry attempts are exhausted', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])

    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    for (let i = 0; i < 5; i += 1) {
      act(() => {
        statusHandlers[0]?.('CHANNEL_ERROR')
      })
    }

    expect(result.current.connectionStatus).toBe('connecting')

    act(() => {
      statusHandlers[0]?.('CHANNEL_ERROR')
    })

    expect(result.current.connectionStatus).toBe('disconnected')

    await act(async () => {
      jest.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(channelFactoryMock).toHaveBeenCalledTimes(1)

    jest.useRealTimers()
  })
})
