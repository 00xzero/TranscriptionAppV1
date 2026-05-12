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
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old project' }])

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('projects', fetchFn, {
        insertPosition: 'prepend',
      })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'old', title: 'Old project' }])
    })

    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'new', title: 'New project' } })
    })

    expect(result.current.data).toEqual([
      { id: 'new', title: 'New project' },
      { id: 'old', title: 'Old project' },
    ])

    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'new', title: 'Updated title' } })
    })

    expect(result.current.data).toEqual([
      { id: 'new', title: 'Updated title' },
      { id: 'old', title: 'Old project' },
    ])
  })

  test('stops polling after realtime connects and performs one resync fetch', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old project' }])

    renderHook(() =>
      useSupabaseRealtime<Row>('projects', fetchFn, {
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
      useSupabaseRealtime<Row>('projects', fetchFn, {
        subscriptionEnabled: false,
      })
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.connectionStatus).toBe('connecting')
    expect(channelFactoryMock).not.toHaveBeenCalled()
  })

  test('retries a channel error instead of parking disconnected', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old project' }])

    const { result } = renderHook(() => useSupabaseRealtime<Row>('projects', fetchFn))

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
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old project' }])

    const { result } = renderHook(() => useSupabaseRealtime<Row>('projects', fetchFn))

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
