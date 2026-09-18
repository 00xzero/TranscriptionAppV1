/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Realtime is the primary update mechanism. Polling is only an opportunistic
 * fallback while the channel is unavailable.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

type TableName = 'transcripts' | 'projects' | 'jobs' | 'speakers'
type InsertPosition = 'append' | 'prepend'
const MAX_REALTIME_RETRIES = 5
const RECONCILIATION_QUIET_MS = 250
const RECONCILIATION_MAX_WAIT_MS = 2000
const EMPTY_REALTIME_DATA: never[] = []

export class RealtimeScopeAbortError extends Error {
    constructor(message = 'The realtime data scope changed') {
        super(message)
        this.name = 'RealtimeScopeAbortError'
    }
}

export function isRealtimeScopeAbortError(error: unknown): error is RealtimeScopeAbortError {
    return error instanceof RealtimeScopeAbortError
}

export function runBackgroundRealtimeRefetch(
    refetch: () => Promise<void>,
    context: string
) {
    void refetch().catch((error: unknown) => {
        if (isRealtimeScopeAbortError(error)) return
        console.error(`[realtime] Failed to reconcile after ${context}:`, error)
    })
}

interface UseRealtimeOptions<T> {
    /** Disable all fetching, subscriptions, retries, and polling */
    enabled?: boolean
    /** Initial data to display while loading */
    initialData?: T[]
    /** Optional Postgres Changes filter, e.g. `transcript_id=eq.<uuid>` */
    realtimeFilter?: string | null
    /** Disable subscription setup while required filter inputs are unavailable */
    subscriptionEnabled?: boolean
    /** Enable 5s polling fallback when realtime fails */
    enablePollingFallback?: boolean
    /** Custom polling interval in ms (default: 5000) */
    pollingInterval?: number
    /** Transform function to strip unwanted fields from realtime payloads */
    transformRealtimePayload?: (row: Record<string, unknown>) => T
    /** Where to place rows that arrive before the next ordered refetch */
    insertPosition?: InsertPosition
}

interface RealtimeState<T> {
    epoch: number
    data: T[]
    isLoading: boolean
    error: Error | null
}

interface ScopedConnectionStatus {
    epoch: number
    status: ConnectionStatus
}

interface FetchWaiter {
    epoch: number
    minimumSequence: number
    resolve: () => void
    reject: (error: Error) => void
}

interface ActiveFetch {
    epoch: number
    sequence: number
    revision: number
    superseded: boolean
}

interface PendingFetch {
    epoch: number
    freshnessRequired: boolean
    firstChangeAt: number
    lastChangeAt: number
}

interface RuntimeOptions<T> {
    epoch: number
    scopeKey: string
    enabled: boolean
    initialData: T[]
    fetchFn: () => Promise<T[]>
    enablePollingFallback: boolean
    pollingInterval: number
    transformRealtimePayload?: (row: Record<string, unknown>) => T
    insertPosition: InsertPosition
}

interface ScopeIdentity {
    descriptor: string
    epoch: number
}

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

/**
 * Hook for subscribing to realtime changes on a table with polling fallback.
 */
export function useSupabaseRealtime<T extends { id: string }>(
    table: TableName,
    fetchFn: () => Promise<T[]>,
    options: UseRealtimeOptions<T> = {}
) {
    const {
        enabled = true,
        initialData = EMPTY_REALTIME_DATA,
        realtimeFilter,
        subscriptionEnabled = true,
        enablePollingFallback = true,
        pollingInterval = 5000,
        transformRealtimePayload,
        insertPosition = 'append',
    } = options

    const scopeKey = JSON.stringify([enabled, table, realtimeFilter ?? null])
    const [scope, setScope] = useState<ScopeIdentity>(() => ({
        descriptor: scopeKey,
        epoch: 0,
    }))
    let scopeEpoch = scope.epoch
    if (scope.descriptor !== scopeKey) {
        scopeEpoch = scope.epoch + 1
        setScope({ descriptor: scopeKey, epoch: scopeEpoch })
    }
    const [state, setState] = useState<RealtimeState<T>>(() => ({
        epoch: scopeEpoch,
        data: enabled ? initialData : [],
        isLoading: enabled,
        error: null,
    }))
    const [connectionState, setConnectionState] = useState<ScopedConnectionStatus>(() => ({
        epoch: scopeEpoch,
        status: enabled ? 'connecting' : 'disconnected',
    }))
    const [subscriptionNonce, setSubscriptionNonce] = useState(0)

    const runtimeRef = useRef<RuntimeOptions<T> | null>(null)
    const committedEpochRef = useRef<number | null>(null)

    useLayoutEffect(() => {
        committedEpochRef.current = scopeEpoch
        return () => {
            if (committedEpochRef.current === scopeEpoch) {
                committedEpochRef.current = null
            }
        }
    }, [scopeEpoch])

    useLayoutEffect(() => {
        runtimeRef.current = {
            epoch: scopeEpoch,
            scopeKey,
            enabled,
            initialData,
            fetchFn,
            enablePollingFallback,
            pollingInterval,
            transformRealtimePayload,
            insertPosition,
        }
    })

    const channelRef = useRef<RealtimeChannel | null>(null)
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const trailingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)
    const isMountedRef = useRef(false)
    const initializedEpochRef = useRef(scopeEpoch)
    const revisionRef = useRef(0)
    const authoritativeSuccessRef = useRef(false)
    const fetchSequenceRef = useRef(0)
    const activeFetchRef = useRef<ActiveFetch | null>(null)
    const pendingFetchRef = useRef<PendingFetch | null>(null)
    const optimisticMutationsRef = useRef(new Map<symbol, number>())
    const waitersRef = useRef<FetchWaiter[]>([])
    const startFetchRef = useRef<() => void>(() => undefined)
    const subscriptionId = useId().replaceAll(':', '')

    const clearTrailingTimeout = useCallback(() => {
        if (trailingTimeoutRef.current) {
            clearTimeout(trailingTimeoutRef.current)
            trailingTimeoutRef.current = null
        }
    }, [])

    const clearOptimisticMutations = useCallback(() => {
        optimisticMutationsRef.current.clear()
    }, [])

    const rejectScopeWaiters = useCallback((cancelledEpoch: number) => {
        const cancellation = new RealtimeScopeAbortError()
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (waiter.epoch === cancelledEpoch) {
                waiter.reject(cancellation)
            } else {
                remaining.push(waiter)
            }
        }

        waitersRef.current = remaining
    }, [])

    const resolveWaiters = useCallback((completedEpoch: number, sequence: number) => {
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (
                waiter.epoch === completedEpoch
                && waiter.minimumSequence <= sequence
            ) {
                waiter.resolve()
            } else {
                remaining.push(waiter)
            }
        }

        waitersRef.current = remaining
    }, [])

    const rejectWaiters = useCallback((failedEpoch: number, sequence: number, error: Error) => {
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (
                waiter.epoch === failedEpoch
                && waiter.minimumSequence <= sequence
            ) {
                waiter.reject(error)
            } else {
                remaining.push(waiter)
            }
        }

        waitersRef.current = remaining
    }, [])

    const schedulePendingFetch = useCallback(() => {
        clearTrailingTimeout()

        const pending = pendingFetchRef.current
        const runtime = runtimeRef.current
        if (
            !pending
            || !runtime
            || committedEpochRef.current !== runtime.epoch
            || activeFetchRef.current
            || optimisticMutationsRef.current.size > 0
            || !runtime.enabled
            || pending.epoch !== runtime.epoch
        ) {
            return
        }

        if (pending.freshnessRequired) {
            startFetchRef.current()
            return
        }

        const deadline = Math.min(
            pending.lastChangeAt + RECONCILIATION_QUIET_MS,
            pending.firstChangeAt + RECONCILIATION_MAX_WAIT_MS
        )
        const delay = Math.max(0, deadline - Date.now())
        trailingTimeoutRef.current = setTimeout(() => {
            trailingTimeoutRef.current = null
            startFetchRef.current()
        }, delay)
    }, [clearTrailingTimeout])

    const queueReconciliation = useCallback((
        expectedEpoch: number,
        freshnessRequired: boolean,
        changedAt = Date.now()
    ) => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== expectedEpoch
            || committedEpochRef.current !== expectedEpoch
        ) return

        const existing = pendingFetchRef.current
        if (existing?.epoch === expectedEpoch) {
            existing.freshnessRequired ||= freshnessRequired
            existing.lastChangeAt = changedAt
        } else {
            pendingFetchRef.current = {
                epoch: expectedEpoch,
                freshnessRequired,
                firstChangeAt: changedAt,
                lastChangeAt: changedAt,
            }
        }

        schedulePendingFetch()
    }, [schedulePendingFetch])

    const startFetch = useCallback(() => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || !runtime.enabled
            || committedEpochRef.current !== runtime.epoch
            || activeFetchRef.current
            || optimisticMutationsRef.current.size > 0
        ) return

        pendingFetchRef.current = null
        clearTrailingTimeout()

        const active: ActiveFetch = {
            epoch: runtime.epoch,
            sequence: ++fetchSequenceRef.current,
            revision: revisionRef.current,
            superseded: false,
        }
        activeFetchRef.current = active
        const fetchForRequest = runtime.fetchFn

        void fetchForRequest()
            .then((result) => {
                const currentRuntime = runtimeRef.current
                const mayApply = isMountedRef.current
                    && activeFetchRef.current === active
                    && currentRuntime !== null
                    && currentRuntime.enabled
                    && currentRuntime.epoch === active.epoch
                    && committedEpochRef.current === active.epoch
                    && revisionRef.current === active.revision
                    && !active.superseded

                if (!mayApply) return

                authoritativeSuccessRef.current = true
                setState({
                    epoch: active.epoch,
                    data: result,
                    isLoading: false,
                    error: null,
                })
                resolveWaiters(active.epoch, active.sequence)
            })
            .catch((caughtError: unknown) => {
                const error = normalizeError(caughtError)
                const currentRuntime = runtimeRef.current
                const isQualifyingFailure = isMountedRef.current
                    && activeFetchRef.current === active
                    && currentRuntime !== null
                    && currentRuntime.enabled
                    && currentRuntime.epoch === active.epoch
                    && committedEpochRef.current === active.epoch
                    && revisionRef.current === active.revision
                    && !active.superseded

                if (!isQualifyingFailure) return

                if (!authoritativeSuccessRef.current) {
                    setState((previous) => ({
                        epoch: active.epoch,
                        data: previous.epoch === active.epoch ? previous.data : currentRuntime.initialData,
                        isLoading: false,
                        error,
                    }))
                }
                rejectWaiters(active.epoch, active.sequence, error)
            })
            .finally(() => {
                if (activeFetchRef.current !== active) return

                activeFetchRef.current = null
                if (pendingFetchRef.current) {
                    schedulePendingFetch()
                }
            })
    }, [clearTrailingTimeout, rejectWaiters, resolveWaiters, schedulePendingFetch])

    // Async callbacks use this indirection so their identity remains stable.
    // eslint-disable-next-line react-hooks/refs -- intentional render-time scheduler refresh
    startFetchRef.current = startFetch

    const assertCurrentScope = useCallback(() => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || runtime.epoch !== scopeEpoch
            || committedEpochRef.current !== scopeEpoch
        ) {
            throw new RealtimeScopeAbortError()
        }
    }, [scopeEpoch])

    const refetch = useCallback((): Promise<void> => {
        try {
            assertCurrentScope()
        } catch (error) {
            return Promise.reject(error)
        }

        const runtime = runtimeRef.current
        if (!runtime?.enabled) return Promise.resolve()

        const active = activeFetchRef.current
        const minimumSequence = active?.epoch === scopeEpoch
            ? active.sequence + 1
            : fetchSequenceRef.current + 1

        const promise = new Promise<void>((resolve, reject) => {
            waitersRef.current.push({
                epoch: scopeEpoch,
                minimumSequence,
                resolve,
                reject,
            })
        })

        if (active?.epoch === scopeEpoch) {
            active.superseded = true
        }
        queueReconciliation(scopeEpoch, true)
        return promise
    }, [assertCurrentScope, queueReconciliation, scopeEpoch])

    const markDataChanged = useCallback((
        expectedEpoch: number,
        scheduleReconciliation = true
    ) => {
        if (committedEpochRef.current !== expectedEpoch) return
        revisionRef.current += 1
        const active = activeFetchRef.current
        if (active?.epoch === expectedEpoch) {
            active.superseded = true
        }
        if (scheduleReconciliation) {
            queueReconciliation(expectedEpoch, false)
        }
    }, [queueReconciliation])

    const applyMutation = useCallback((
        expectedEpoch: number,
        newData: T[] | ((previous: T[]) => T[]),
        scheduleReconciliation: boolean
    ) => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== expectedEpoch
            || committedEpochRef.current !== expectedEpoch
        ) return

        markDataChanged(expectedEpoch, scheduleReconciliation)
        setState((previous) => {
            const previousData = previous.epoch === expectedEpoch
                ? previous.data
                : runtime.initialData
            const data = typeof newData === 'function'
                ? newData(previousData)
                : newData

            return {
                epoch: expectedEpoch,
                data,
                isLoading: previous.epoch === expectedEpoch
                    ? previous.isLoading
                    : true,
                error: previous.epoch === expectedEpoch
                    ? previous.error
                    : null,
            }
        })
    }, [markDataChanged])

    const mutate = useCallback((newData?: T[] | ((previous: T[]) => T[])) => {
        if (committedEpochRef.current !== scopeEpoch) return
        if (newData === undefined) {
            runBackgroundRealtimeRefetch(refetch, 'manual mutation revalidation')
            return
        }

        applyMutation(scopeEpoch, newData, true)
    }, [applyMutation, refetch, scopeEpoch])

    const mutateOptimistically = useCallback((
        newData: T[] | ((previous: T[]) => T[])
    ) => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== scopeEpoch
            || committedEpochRef.current !== scopeEpoch
        ) return () => undefined

        const token = Symbol('optimistic-mutation')
        optimisticMutationsRef.current.set(token, scopeEpoch)
        // Invalidate older snapshots immediately, but do not fetch until the
        // caller's write settles; a pre-commit fetch could restore old data.
        applyMutation(scopeEpoch, newData, false)
        return () => {
            const tokenEpoch = optimisticMutationsRef.current.get(token)
            optimisticMutationsRef.current.delete(token)
            if (
                tokenEpoch !== scopeEpoch
                || committedEpochRef.current !== scopeEpoch
            ) return
            queueReconciliation(scopeEpoch, false)
        }
    }, [applyMutation, queueReconciliation, scopeEpoch])

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    const startPolling = useCallback(() => {
        const runtime = runtimeRef.current
        if (
            !runtime
            || committedEpochRef.current !== runtime.epoch
            || !runtime.enablePollingFallback
            || pollingRef.current
        ) return

        const pollingEpoch = runtime.epoch
        pollingRef.current = setInterval(() => {
            const currentRuntime = runtimeRef.current
            if (
                !currentRuntime
                || currentRuntime.epoch !== pollingEpoch
                || committedEpochRef.current !== pollingEpoch
                || committedEpochRef.current !== currentRuntime.epoch
                || !currentRuntime.enabled
                || activeFetchRef.current
                || pendingFetchRef.current
                || optimisticMutationsRef.current.size > 0
            ) {
                return
            }
            startFetchRef.current()
        }, runtime.pollingInterval)
    }, [])

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = null
        }
    }, [])

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
            const cancelledEpoch = initializedEpochRef.current
            activeFetchRef.current = null
            pendingFetchRef.current = null
            clearOptimisticMutations()
            clearTrailingTimeout()
            stopPolling()
            clearRetryTimeout()
            rejectScopeWaiters(cancelledEpoch)
        }
    }, [
        clearOptimisticMutations,
        clearRetryTimeout,
        clearTrailingTimeout,
        rejectScopeWaiters,
        stopPolling,
    ])

    useEffect(() => {
        const previousEpoch = initializedEpochRef.current
        if (previousEpoch === scopeEpoch) return

        rejectScopeWaiters(previousEpoch)
        const active = activeFetchRef.current
        if (active?.epoch === previousEpoch) {
            active.superseded = true
            activeFetchRef.current = null
        }
        pendingFetchRef.current = null
        clearOptimisticMutations()
        clearTrailingTimeout()
        revisionRef.current = 0
        authoritativeSuccessRef.current = false
        initializedEpochRef.current = scopeEpoch
        retryCountRef.current = 0
        stopPolling()
        clearRetryTimeout()
        setConnectionState({
            epoch: scopeEpoch,
            status: enabled ? 'connecting' : 'disconnected',
        })
        const runtime = runtimeRef.current
        setState({
            epoch: scopeEpoch,
            data: enabled ? runtime?.initialData ?? initialData : EMPTY_REALTIME_DATA,
            isLoading: enabled,
            error: null,
        })

        if (enabled) {
            startFetchRef.current()
        }
    }, [
        clearRetryTimeout,
        clearOptimisticMutations,
        clearTrailingTimeout,
        enabled,
        initialData,
        rejectScopeWaiters,
        scopeEpoch,
        stopPolling,
    ])

    useEffect(() => {
        if (
            enabled
            && committedEpochRef.current === scopeEpoch
            && !authoritativeSuccessRef.current
            && !activeFetchRef.current
        ) {
            startFetchRef.current()
        }
    }, [enabled, scopeEpoch])

    useEffect(() => {
        if (!enabled || !subscriptionEnabled) {
            // Connection state follows subscription lifecycle rather than render state.
            // eslint-disable-next-line react-hooks/set-state-in-effect -- lifecycle synchronization
            setConnectionState({
                epoch: scopeEpoch,
                status: enabled ? 'connecting' : 'disconnected',
            })
            retryCountRef.current = 0
            stopPolling()
            clearRetryTimeout()
            return
        }

        const subscriptionEpoch = scopeEpoch
        const supabase = createClient()
        const changesFilter = {
            event: '*',
            schema: 'public',
            table,
            ...(realtimeFilter ? { filter: realtimeFilter } : {}),
        } as const
        const channelName = `${table}-changes:${realtimeFilter ?? 'all'}:${subscriptionId}:${subscriptionEpoch}:${subscriptionNonce}`
        const channel = supabase
            .channel(channelName)
            .on<T>(
                'postgres_changes',
                changesFilter,
                (payload: RealtimePostgresChangesPayload<T>) => {
                    const runtime = runtimeRef.current
                    if (
                        !isMountedRef.current
                        || !runtime
                        || !runtime.enabled
                        || runtime.epoch !== subscriptionEpoch
                        || committedEpochRef.current !== subscriptionEpoch
                    ) {
                        return
                    }

                    markDataChanged(subscriptionEpoch)
                    if (payload.eventType === 'DELETE') {
                        setState((previous) => ({
                            epoch: subscriptionEpoch,
                            data: previous.epoch === subscriptionEpoch
                                ? previous.data.filter((item) => item.id !== (payload.old as T).id)
                                : runtime.initialData,
                            isLoading: previous.epoch === subscriptionEpoch
                                ? previous.isLoading
                                : true,
                            error: previous.epoch === subscriptionEpoch ? previous.error : null,
                        }))
                        return
                    }

                    const item = runtime.transformRealtimePayload
                        ? runtime.transformRealtimePayload(payload.new as Record<string, unknown>)
                        : payload.new as T
                    setState((previous) => {
                        const previousData = previous.epoch === subscriptionEpoch
                            ? previous.data
                            : runtime.initialData
                        const existingIndex = previousData.findIndex((current) => current.id === item.id)
                        const data = existingIndex === -1
                            ? runtime.insertPosition === 'prepend'
                                ? [item, ...previousData]
                                : [...previousData, item]
                            : previousData.map((current) => current.id === item.id ? item : current)

                        return {
                            epoch: subscriptionEpoch,
                            data,
                            isLoading: previous.epoch === subscriptionEpoch
                                ? previous.isLoading
                                : true,
                            error: previous.epoch === subscriptionEpoch ? previous.error : null,
                        }
                    })
                }
            )
            .subscribe((status) => {
                if (
                    !isMountedRef.current
                    || runtimeRef.current?.epoch !== subscriptionEpoch
                    || committedEpochRef.current !== subscriptionEpoch
                ) {
                    return
                }

                if (status === 'SUBSCRIBED') {
                    retryCountRef.current = 0
                    clearRetryTimeout()
                    setConnectionState({ epoch: subscriptionEpoch, status: 'connected' })
                    stopPolling()
                    runBackgroundRealtimeRefetch(
                        refetch,
                        'realtime subscription synchronization'
                    )
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    startPolling()

                    if (retryCountRef.current < MAX_REALTIME_RETRIES) {
                        retryCountRef.current += 1
                        setConnectionState({ epoch: subscriptionEpoch, status: 'connecting' })
                        clearRetryTimeout()
                        retryTimeoutRef.current = setTimeout(() => {
                            if (
                                !isMountedRef.current
                                || runtimeRef.current?.epoch !== subscriptionEpoch
                                || committedEpochRef.current !== subscriptionEpoch
                            ) return
                            setSubscriptionNonce((current) => current + 1)
                        }, Math.min(250 * retryCountRef.current, 1000))
                    } else {
                        clearRetryTimeout()
                        setConnectionState({ epoch: subscriptionEpoch, status: 'disconnected' })
                    }
                } else {
                    setConnectionState({ epoch: subscriptionEpoch, status: 'connecting' })
                    startPolling()
                }
            })

        channelRef.current = channel
        return () => {
            stopPolling()
            clearRetryTimeout()
            if (channelRef.current === channel) {
                channelRef.current = null
            }
            void supabase.removeChannel(channel)
        }
    }, [
        clearRetryTimeout,
        enabled,
        markDataChanged,
        realtimeFilter,
        refetch,
        scopeEpoch,
        startPolling,
        stopPolling,
        subscriptionId,
        subscriptionEnabled,
        subscriptionNonce,
        table,
    ])

    const exposedState = state.epoch === scopeEpoch
        ? state
        : {
            epoch: scopeEpoch,
            data: enabled ? initialData : [],
            isLoading: enabled,
            error: null,
        }

    return {
        data: enabled ? exposedState.data : [],
        isLoading: enabled ? exposedState.isLoading : false,
        error: enabled ? exposedState.error : null,
        connectionStatus: enabled
            ? connectionState.epoch === scopeEpoch
                ? connectionState.status
                : 'connecting'
            : 'disconnected' as const,
        mutate,
        mutateOptimistically,
        refetch,
        assertCurrentScope,
    }
}

// Re-export types for convenience
export type { RealtimePostgresChangesPayload }
