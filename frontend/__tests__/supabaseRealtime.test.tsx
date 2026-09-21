import React, { startTransition } from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  RealtimeScopeAbortError,
  runBackgroundRealtimeRefetch,
  useSupabaseRealtime,
} from '@/lib/supabase/realtime'

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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
      changeHandler?.({ eventType: 'UPDATE', new: { id: 'new', title: 'Updated title' } })
    })

    expect(result.current.data).toEqual([
      { id: 'new', title: 'Updated title' },
      { id: 'old', title: 'Old transcript' },
    ])

    act(() => {
      changeHandler?.({ eventType: 'DELETE', old: { id: 'old' } })
    })
    expect(result.current.data).toEqual([{ id: 'new', title: 'Updated title' }])
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

  test('does not refetch an optimistic mutation before its write settles', async () => {
    jest.useFakeTimers()
    const preWriteFetch = deferred<Row[]>()
    const postWriteFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'row', title: 'Old title' }])
      .mockReturnValueOnce(preWriteFetch.promise)
      .mockReturnValueOnce(postWriteFetch.promise)
    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.data).toEqual([{ id: 'row', title: 'Old title' }])

    let olderRefetch!: Promise<void>
    act(() => {
      olderRefetch = result.current.refetch()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    let settleOptimistic!: () => void
    act(() => {
      settleOptimistic = result.current.mutateOptimistically([
        { id: 'row', title: 'Optimistic title' },
      ])
    })
    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'live', title: 'Realtime row' } })
    })
    await act(async () => {
      preWriteFetch.resolve([{ id: 'row', title: 'Old title' }])
      await preWriteFetch.promise
    })
    expect(result.current.data).toEqual([
      { id: 'row', title: 'Optimistic title' },
      { id: 'live', title: 'Realtime row' },
    ])

    await act(async () => {
      jest.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    let settledRefetch!: Promise<void>
    act(() => {
      settleOptimistic()
      settledRefetch = result.current.refetch()
    })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    await act(async () => {
      postWriteFetch.resolve([
        { id: 'row', title: 'Saved title' },
        { id: 'live', title: 'Realtime row' },
      ])
      await Promise.all([postWriteFetch.promise, olderRefetch, settledRefetch])
    })
    expect(result.current.data).toEqual([
      { id: 'row', title: 'Saved title' },
      { id: 'live', title: 'Realtime row' },
    ])
    jest.useRealTimers()
  })

  test('starts explicit refetch after the active fetch and keeps its caller pending', async () => {
    const olderFetch = deferred<Row[]>()
    const newerFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(olderFetch.promise)
      .mockReturnValueOnce(newerFetch.promise)

    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled: false })
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    let refetchSettled = false
    let refetchPromise!: Promise<void>
    act(() => {
      refetchPromise = result.current.refetch().finally(() => {
        refetchSettled = true
      })
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(refetchSettled).toBe(false)

    await act(async () => {
      olderFetch.resolve([{ id: 'old', title: 'Old transcript' }])
      await olderFetch.promise
    })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    expect(refetchSettled).toBe(false)

    await act(async () => {
      newerFetch.resolve([{ id: 'new', title: 'New transcript' }])
      await Promise.all([newerFetch.promise, refetchPromise])
    })
    expect(result.current.data).toEqual([{ id: 'new', title: 'New transcript' }])
    expect(refetchSettled).toBe(true)
  })

  test('coalesces explicit callers onto the same not-yet-started fetch', async () => {
    const activeFetch = deferred<Row[]>()
    const qualifyingFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(activeFetch.promise)
      .mockReturnValueOnce(qualifyingFetch.promise)
    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled: false })
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.refetch()
      second = result.current.refetch()
    })

    await act(async () => {
      activeFetch.resolve([{ id: 'stale', title: 'Stale' }])
      await activeFetch.promise
    })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))

    await act(async () => {
      qualifyingFetch.resolve([{ id: 'fresh', title: 'Fresh' }])
      await Promise.all([first, second])
    })
    expect(result.current.data).toEqual([{ id: 'fresh', title: 'Fresh' }])
  })

  test('rejects explicit callers on a qualifying failure without clearing settled data', async () => {
    const failure = new Error('refresh failed')
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'settled', title: 'Settled' }])
      .mockRejectedValueOnce(failure)
    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled: false })
    )

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    await expect(result.current.refetch()).rejects.toBe(failure)
    expect(result.current.data).toEqual([{ id: 'settled', title: 'Settled' }])
    expect(result.current.error).toBeNull()
  })

  test('logs a failed subscription synchronization after data has settled', async () => {
    const failure = new Error('resynchronization failed')
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'settled', title: 'Settled' }])
      .mockRejectedValueOnce(failure)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))

    try {
      await waitFor(() => expect(result.current.data).toEqual([{ id: 'settled', title: 'Settled' }]))
      act(() => statusHandler?.('SUBSCRIBED'))

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[realtime] Failed to reconcile after realtime subscription synchronization:',
          failure
        )
      })
      expect(result.current.data).toEqual([{ id: 'settled', title: 'Settled' }])
      expect(result.current.error).toBeNull()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('does not log scope cancellation from background reconciliation', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await act(async () => {
        runBackgroundRealtimeRefetch(
          () => Promise.reject(new RealtimeScopeAbortError()),
          'scope teardown'
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('exposes a fatal initial failure and clears it after an explicit recovery', async () => {
    const failure = new Error('initial failure')
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([{ id: 'recovered', title: 'Recovered' }])
    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled: false })
    )

    await waitFor(() => expect(result.current.error).toBe(failure))
    expect(result.current.isLoading).toBe(false)
    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual([{ id: 'recovered', title: 'Recovered' }])
  })

  test('rejects outstanding explicit callers with the named error on scope change', async () => {
    const pendingRefresh = deferred<Row[]>()
    const nextScopeFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'old', title: 'Old' }])
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockReturnValueOnce(nextScopeFetch.promise)
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, {
          realtimeFilter: filter,
          subscriptionEnabled: false,
        }),
      { initialProps: { filter: 'user_id=eq.user-a' } }
    )

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'old', title: 'Old' }]))
    const refresh = result.current.refetch()
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    rerender({ filter: 'user_id=eq.user-b' })

    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await expect(refresh).rejects.toBeInstanceOf(RealtimeScopeAbortError)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))
  })

  test('preserves optimistic work started by a child effect in the new epoch', async () => {
    const oldScopeFetch = deferred<Row[]>()
    const newScopeFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(oldScopeFetch.promise)
      .mockReturnValueOnce(newScopeFetch.promise)
    let current!: ReturnType<typeof useSupabaseRealtime<Row>>
    let settleOptimistic!: () => void

    function StartsNewScopeAction({
      filter,
      mutateOptimistically,
    }: {
      filter: string
      mutateOptimistically: ReturnType<typeof useSupabaseRealtime<Row>>['mutateOptimistically']
    }) {
      React.useEffect(() => {
        if (filter !== 'user_id=eq.user-b') return
        settleOptimistic = mutateOptimistically([
          { id: 'optimistic-b', title: 'Optimistic B' },
        ])
      }, [filter, mutateOptimistically])
      return null
    }

    function Harness({ filter }: { filter: string }) {
      current = useSupabaseRealtime<Row>('transcripts', fetchFn, {
        realtimeFilter: filter,
        subscriptionEnabled: false,
      })
      return (
        <StartsNewScopeAction
          filter={filter}
          mutateOptimistically={current.mutateOptimistically}
        />
      )
    }

    const view = render(<Harness filter="user_id=eq.user-a" />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))

    view.rerender(<Harness filter="user_id=eq.user-b" />)

    await waitFor(() => {
      expect(current.data).toEqual([{ id: 'optimistic-b', title: 'Optimistic B' }])
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    act(() => settleOptimistic())
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))

    await act(async () => {
      newScopeFetch.resolve([{ id: 'saved-b', title: 'Saved B' }])
      oldScopeFetch.resolve([{ id: 'stale-a', title: 'Stale A' }])
      await Promise.all([newScopeFetch.promise, oldScopeFetch.promise])
    })
    expect(current.data).toEqual([{ id: 'saved-b', title: 'Saved B' }])
  })

  test('keeps disabled data identity stable across rerenders', () => {
    const fetchFn = jest.fn().mockResolvedValue([])
    const { result, rerender } = renderHook(
      ({ renderCount }: { renderCount: number }) => {
        void renderCount
        return useSupabaseRealtime<Row>('transcripts', fetchFn, {
          enabled: false,
          subscriptionEnabled: false,
        })
      },
      { initialProps: { renderCount: 0 } }
    )
    const disabledData = result.current.data

    rerender({ renderCount: 1 })

    expect(result.current.data).toBe(disabledData)
  })

  test('isolates repeated A to B to A scope instances and their captured callbacks', async () => {
    const firstA = deferred<Row[]>()
    const scopeB = deferred<Row[]>()
    const secondA = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(scopeB.promise)
      .mockReturnValueOnce(secondA.promise)
    const { result, rerender } = renderHook(
      ({ filter }: { filter: string }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, { realtimeFilter: filter }),
      { initialProps: { filter: 'user_id=eq.user-a' } }
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    const firstCallbacks = result.current
    const firstChannel = channelFactoryMock.mock.results[0].value
    const firstRealtimeCallback = firstChannel.on.mock.calls[0][2]
    const firstStatusCallback = firstChannel.subscribe.mock.calls[0][0]
    const settleFirstOptimistic = firstCallbacks.mutateOptimistically([
      { id: 'optimistic-a1', title: 'Optimistic A1' },
    ])
    const firstRefetch = firstCallbacks.refetch()

    rerender({ filter: 'user_id=eq.user-b' })
    rerender({ filter: 'user_id=eq.user-a' })

    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    expect(result.current.connectionStatus).toBe('connecting')
    await expect(firstRefetch).rejects.toBeInstanceOf(RealtimeScopeAbortError)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))

    act(() => {
      firstCallbacks.mutate([{ id: 'stale-mutation', title: 'Stale mutation' }])
      settleFirstOptimistic()
      firstRealtimeCallback({
        eventType: 'INSERT',
        new: { id: 'stale-event', title: 'Stale event' },
      })
      firstStatusCallback('SUBSCRIBED')
    })

    await act(async () => {
      firstA.resolve([{ id: 'stale-fetch', title: 'Stale fetch' }])
      secondA.resolve([{ id: 'fresh-a2', title: 'Fresh A2' }])
      await Promise.all([firstA.promise, secondA.promise])
    })

    expect(result.current.data).toEqual([{ id: 'fresh-a2', title: 'Fresh A2' }])
    expect(result.current.connectionStatus).toBe('connecting')
    const epochs = channelFactoryMock.mock.calls.map(([name]) => String(name).split(':').at(-3))
    expect(epochs).toEqual(['0', '1', '2'])
  })

  test('resolves current disabled refetches but rejects callbacks from the previous epoch', async () => {
    const fetchFn = jest.fn().mockResolvedValue([])
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, {
          enabled,
          subscriptionEnabled: false,
        }),
      { initialProps: { enabled: false } }
    )

    const disabledRefetch = result.current.refetch
    await expect(disabledRefetch()).resolves.toBeUndefined()
    rerender({ enabled: true })

    await expect(disabledRefetch()).rejects.toBeInstanceOf(RealtimeScopeAbortError)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
  })

  test('invalidates epoch callbacks on unmount and restores them in Strict Mode', async () => {
    const fetchFn = jest.fn().mockResolvedValue([])
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    )
    const { result, unmount } = renderHook(
      () => useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled: false }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(() => result.current.assertCurrentScope()).not.toThrow()
    const assertCommittedScope = result.current.assertCurrentScope
    unmount()
    expect(() => assertCommittedScope()).toThrow(RealtimeScopeAbortError)
  })

  test('uses a fresh table channel lifecycle when the effect restarts within an epoch', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([])
    const { rerender, unmount } = renderHook(
      ({ subscriptionEnabled }: { subscriptionEnabled: boolean }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, { subscriptionEnabled }),
      { initialProps: { subscriptionEnabled: true } }
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(channelFactoryMock).toHaveBeenCalledTimes(1)

    rerender({ subscriptionEnabled: false })
    rerender({ subscriptionEnabled: true })

    expect(channelFactoryMock).toHaveBeenCalledTimes(2)
    const firstChannelName = channelFactoryMock.mock.calls[0][0]
    const secondChannelName = channelFactoryMock.mock.calls[1][0]
    expect(secondChannelName).not.toBe(firstChannelName)

    act(() => {
      statusHandlers[0]?.('CHANNEL_ERROR')
      jest.runOnlyPendingTimers()
    })
    expect(channelFactoryMock).toHaveBeenCalledTimes(2)

    unmount()
    jest.useRealTimers()
  })

  test('does not advance the committed epoch for an abandoned transition render', async () => {
    const fetchFn = jest.fn().mockResolvedValue([])
    const never = new Promise<void>(() => undefined)
    let setFilter!: React.Dispatch<React.SetStateAction<string>>
    let committedResult!: ReturnType<typeof useSupabaseRealtime<Row>>

    function SuspendsForB({ filter }: { filter: string }) {
      if (filter === 'user_id=eq.user-b') throw never
      return null
    }

    function Harness() {
      const [filter, updateFilter] = React.useState('user_id=eq.user-a')
      const realtime = useSupabaseRealtime<Row>('transcripts', fetchFn, {
        realtimeFilter: filter,
        subscriptionEnabled: false,
      })
      React.useLayoutEffect(() => {
        setFilter = updateFilter
        committedResult = realtime
      }, [realtime])
      return (
        <React.Suspense fallback={null}>
          <SuspendsForB filter={filter} />
        </React.Suspense>
      )
    }

    const view = render(<Harness />)
    await waitFor(() => expect(committedResult.isLoading).toBe(false))
    const committedAssert = committedResult.assertCurrentScope
    const channelsBefore = channelFactoryMock.mock.calls.length

    act(() => {
      startTransition(() => setFilter('user_id=eq.user-b'))
    })

    expect(() => committedAssert()).not.toThrow()
    expect(channelFactoryMock).toHaveBeenCalledTimes(channelsBefore)
    view.unmount()
  })

  test('keeps first-load data changes and reconciles after the quiet window', async () => {
    jest.useFakeTimers()
    const staleFetch = deferred<Row[]>()
    const reconciliation = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(reconciliation.promise)
    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))

    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: 'live', title: 'Live' } })
    })
    await act(async () => {
      staleFetch.resolve([{ id: 'stale', title: 'Stale' }])
      await staleFetch.promise
    })

    expect(result.current.data).toEqual([{ id: 'live', title: 'Live' }])
    expect(result.current.isLoading).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await act(async () => {
      reconciliation.resolve([
        { id: 'live', title: 'Live' },
        { id: 'server', title: 'Server' },
      ])
      await reconciliation.promise
    })
    expect(result.current.data).toHaveLength(2)
    expect(result.current.isLoading).toBe(false)
    jest.useRealTimers()
  })

  test('uses a two-second maximum wait under continuous realtime changes', async () => {
    jest.useFakeTimers()
    const fetchFn = jest.fn().mockResolvedValue([])
    renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    act(() => {
      changeHandler?.({ eventType: 'INSERT', new: { id: '0', title: '0' } })
    })
    for (let index = 1; index <= 9; index += 1) {
      await act(async () => {
        jest.advanceTimersByTime(200)
        changeHandler?.({
          eventType: 'UPDATE',
          new: { id: String(index), title: String(index) },
        })
        await Promise.resolve()
      })
    }
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      jest.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })

  test('discards a trailing fetch changed by realtime and runs another reconciliation', async () => {
    jest.useFakeTimers()
    const trailingFetch = deferred<Row[]>()
    const replacementFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'initial', title: 'Initial' }])
      .mockReturnValueOnce(trailingFetch.promise)
      .mockReturnValueOnce(replacementFetch.promise)
    const { result } = renderHook(() => useSupabaseRealtime<Row>('transcripts', fetchFn))
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      changeHandler?.({ eventType: 'UPDATE', new: { id: 'initial', title: 'Live one' } })
    })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    act(() => {
      changeHandler?.({ eventType: 'UPDATE', new: { id: 'initial', title: 'Live two' } })
    })
    await act(async () => {
      trailingFetch.resolve([{ id: 'initial', title: 'Stale trailing' }])
      await trailingFetch.promise
    })
    expect(result.current.data).toEqual([{ id: 'initial', title: 'Live two' }])

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    await act(async () => {
      replacementFetch.resolve([{ id: 'initial', title: 'Authoritative' }])
      await replacementFetch.promise
    })
    expect(result.current.data).toEqual([{ id: 'initial', title: 'Authoritative' }])
    jest.useRealTimers()
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

  test('does not create or invalidate requests while a poll fetch is active', async () => {
    jest.useFakeTimers()
    const longPoll = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'initial', title: 'Initial' }])
      .mockReturnValueOnce(longPoll.promise)
      .mockResolvedValue([{ id: 'later', title: 'Later' }])
    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { pollingInterval: 5000 })
    )
    await act(async () => {
      await Promise.resolve()
    })

    act(() => statusHandler?.('TIMED_OUT'))
    await act(async () => {
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await act(async () => {
      jest.advanceTimersByTime(15000)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(result.current.data).toEqual([{ id: 'initial', title: 'Initial' }])

    await act(async () => {
      longPoll.resolve([{ id: 'poll', title: 'Poll' }])
      await longPoll.promise
      await Promise.resolve()
    })
    await act(async () => {
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
    })
    expect(fetchFn).toHaveBeenCalledTimes(3)
    jest.useRealTimers()
  })

  test('reconnect and explicit refetch both supersede an active poll', async () => {
    jest.useFakeTimers()
    const poll = deferred<Row[]>()
    const reconnectFetch = deferred<Row[]>()
    const explicitFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'initial', title: 'Initial' }])
      .mockReturnValueOnce(poll.promise)
      .mockReturnValueOnce(reconnectFetch.promise)
      .mockReturnValueOnce(explicitFetch.promise)
    const { result } = renderHook(() =>
      useSupabaseRealtime<Row>('transcripts', fetchFn, { pollingInterval: 5000 })
    )
    await act(async () => {
      await Promise.resolve()
    })
    act(() => statusHandler?.('TIMED_OUT'))
    await act(async () => {
      jest.advanceTimersByTime(5000)
      await Promise.resolve()
    })

    act(() => statusHandler?.('SUBSCRIBED'))
    expect(fetchFn).toHaveBeenCalledTimes(2)
    await act(async () => {
      poll.resolve([{ id: 'stale-poll', title: 'Stale poll' }])
      await poll.promise
    })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))

    let explicit!: Promise<void>
    act(() => {
      explicit = result.current.refetch()
    })
    await act(async () => {
      reconnectFetch.resolve([{ id: 'stale-reconnect', title: 'Stale reconnect' }])
      await reconnectFetch.promise
    })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(4))

    await act(async () => {
      explicitFetch.resolve([{ id: 'fresh', title: 'Fresh' }])
      await Promise.all([explicitFetch.promise, explicit])
    })
    expect(result.current.data).toEqual([{ id: 'fresh', title: 'Fresh' }])
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

  test('changing fetchFn alone preserves data and channels while using the latest callback', async () => {
    const firstFetch = jest.fn().mockResolvedValue([{ id: 'first', title: 'First' }])
    const latestFetch = jest.fn().mockResolvedValue([{ id: 'latest', title: 'Latest' }])
    const { result, rerender } = renderHook(
      ({ currentFetch }: { currentFetch: () => Promise<Row[]> }) =>
        useSupabaseRealtime<Row>('transcripts', currentFetch),
      { initialProps: { currentFetch: firstFetch } }
    )

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'first', title: 'First' }]))
    expect(channelFactoryMock).toHaveBeenCalledTimes(1)

    rerender({ currentFetch: latestFetch })
    expect(result.current.data).toEqual([{ id: 'first', title: 'First' }])
    expect(result.current.isLoading).toBe(false)
    expect(channelFactoryMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.refetch()
    })
    expect(latestFetch).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual([{ id: 'latest', title: 'Latest' }])
  })

  test('keeps one channel and one fetch across rerenders with inline options', async () => {
    const fetchFn = jest.fn().mockResolvedValue([{ id: 'old', title: 'Old transcript' }])
    const { result, rerender } = renderHook(
      ({ render }: { render: number }) =>
        useSupabaseRealtime<Row>('transcripts', fetchFn, {
          initialData: [],
          realtimeFilter: 'id=eq.old',
          insertPosition: 'prepend',
          transformRealtimePayload: (row) => ({
            id: String(row.id),
            title: `${String(row.title)} (${render})`,
          }),
        }),
      { initialProps: { render: 0 } }
    )

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])
    })

    for (let render = 1; render <= 3; render += 1) {
      rerender({ render })
    }

    act(() => {
      changeHandler?.({ eventType: 'UPDATE', new: { id: 'old', title: 'Updated' } })
    })

    expect(result.current.data).toEqual([{ id: 'old', title: 'Updated (3)' }])
    expect(channelFactoryMock).toHaveBeenCalledTimes(1)
    expect(removeChannelMock).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('uses the latest callback when scope and callback change in the same commit', async () => {
    const firstFetch = jest.fn().mockResolvedValue([{ id: 'first', title: 'First' }])
    const secondRequest = deferred<Row[]>()
    const secondFetch = jest.fn().mockReturnValue(secondRequest.promise)
    const { result, rerender } = renderHook(
      ({ filter, currentFetch }: { filter: string; currentFetch: () => Promise<Row[]> }) =>
        useSupabaseRealtime<Row>('transcripts', currentFetch, {
          realtimeFilter: filter,
          subscriptionEnabled: false,
        }),
      {
        initialProps: {
          filter: 'user_id=eq.user-a',
          currentFetch: firstFetch,
        },
      }
    )

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'first', title: 'First' }]))
    rerender({ filter: 'user_id=eq.user-b', currentFetch: secondFetch })
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(secondFetch).toHaveBeenCalledTimes(1))
    expect(firstFetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      secondRequest.resolve([{ id: 'second', title: 'Second' }])
      await secondRequest.promise
    })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'second', title: 'Second' }]))
  })

  test('treats a table change as a new scope', async () => {
    const projectFetch = deferred<Row[]>()
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'transcript', title: 'Transcript' }])
      .mockReturnValueOnce(projectFetch.promise)
    const { result, rerender } = renderHook(
      ({ table }: { table: 'transcripts' | 'projects' }) =>
        useSupabaseRealtime<Row>(table, fetchFn, { subscriptionEnabled: false }),
      {
        initialProps: {
          table: 'transcripts',
        } as { table: 'transcripts' | 'projects' },
      }
    )

    await waitFor(() => expect(result.current.data[0]?.id).toBe('transcript'))
    rerender({ table: 'projects' })
    expect(result.current.data).toEqual([])
    expect(result.current.isLoading).toBe(true)
    await act(async () => {
      projectFetch.resolve([{ id: 'project', title: 'Project' }])
      await projectFetch.promise
    })
    await waitFor(() => expect(result.current.data[0]?.id).toBe('project'))
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
    expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(channelFactoryMock).toHaveBeenCalledTimes(2)
    })
    expect(result.current.data).toEqual([{ id: 'old', title: 'Old transcript' }])

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
