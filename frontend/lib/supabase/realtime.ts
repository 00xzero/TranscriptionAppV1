/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Realtime is the primary update mechanism. Polling is only an opportunistic
 * fallback while the channel is unavailable.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
    scopeKey: string
    data: T[]
    isLoading: boolean
    error: Error | null
}

interface FetchWaiter {
    scopeKey: string
    minimumSequence: number
    resolve: () => void
    reject: (error: Error) => void
}

interface ActiveFetch {
    scopeKey: string
    sequence: number
    revision: number
    superseded: boolean
}

interface PendingFetch {
    scopeKey: string
    freshnessRequired: boolean
    firstChangeAt: number
    lastChangeAt: number
}

interface RuntimeOptions<T> {
    scopeKey: string
    enabled: boolean
    initialData: T[]
    fetchFn: () => Promise<T[]>
    enablePollingFallback: boolean
    pollingInterval: number
    transformRealtimePayload?: (row: Record<string, unknown>) => T
    insertPosition: InsertPosition
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
    const [state, setState] = useState<RealtimeState<T>>(() => ({
        scopeKey,
        data: enabled ? initialData : [],
        isLoading: enabled,
        error: null,
    }))
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
        enabled ? 'connecting' : 'disconnected'
    )
    const [subscriptionNonce, setSubscriptionNonce] = useState(0)

    const runtimeRef = useRef<RuntimeOptions<T>>({
        scopeKey,
        enabled,
        initialData,
        fetchFn,
        enablePollingFallback,
        pollingInterval,
        transformRealtimePayload,
        insertPosition,
    })
    // This must update during render so a scope-changing commit cannot launch a stale callback.
    // eslint-disable-next-line react-hooks/refs -- intentional latest-value ref for async scheduling
    runtimeRef.current = {
        scopeKey,
        enabled,
        initialData,
        fetchFn,
        enablePollingFallback,
        pollingInterval,
        transformRealtimePayload,
        insertPosition,
    }

    const channelRef = useRef<RealtimeChannel | null>(null)
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const trailingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)
    const isMountedRef = useRef(false)
    const currentScopeRef = useRef(scopeKey)
    const revisionRef = useRef(0)
    const authoritativeSuccessRef = useRef(false)
    const fetchSequenceRef = useRef(0)
    const activeFetchRef = useRef<ActiveFetch | null>(null)
    const pendingFetchRef = useRef<PendingFetch | null>(null)
    const waitersRef = useRef<FetchWaiter[]>([])
    const startFetchRef = useRef<() => void>(() => undefined)
    const subscriptionId = useId().replaceAll(':', '')

    const clearTrailingTimeout = useCallback(() => {
        if (trailingTimeoutRef.current) {
            clearTimeout(trailingTimeoutRef.current)
            trailingTimeoutRef.current = null
        }
    }, [])

    const rejectScopeWaiters = useCallback((cancelledScopeKey: string) => {
        const cancellation = new RealtimeScopeAbortError()
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (waiter.scopeKey === cancelledScopeKey) {
                waiter.reject(cancellation)
            } else {
                remaining.push(waiter)
            }
        }

        waitersRef.current = remaining
    }, [])

    const resolveWaiters = useCallback((completedScopeKey: string, sequence: number) => {
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (
                waiter.scopeKey === completedScopeKey
                && waiter.minimumSequence <= sequence
            ) {
                waiter.resolve()
            } else {
                remaining.push(waiter)
            }
        }

        waitersRef.current = remaining
    }, [])

    const rejectWaiters = useCallback((failedScopeKey: string, sequence: number, error: Error) => {
        const remaining: FetchWaiter[] = []

        for (const waiter of waitersRef.current) {
            if (
                waiter.scopeKey === failedScopeKey
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
            || activeFetchRef.current
            || !runtime.enabled
            || pending.scopeKey !== runtime.scopeKey
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

    const queueReconciliation = useCallback((freshnessRequired: boolean, changedAt = Date.now()) => {
        const runtime = runtimeRef.current
        if (!runtime.enabled) return

        const existing = pendingFetchRef.current
        if (existing?.scopeKey === runtime.scopeKey) {
            existing.freshnessRequired ||= freshnessRequired
            existing.lastChangeAt = changedAt
        } else {
            pendingFetchRef.current = {
                scopeKey: runtime.scopeKey,
                freshnessRequired,
                firstChangeAt: changedAt,
                lastChangeAt: changedAt,
            }
        }

        schedulePendingFetch()
    }, [schedulePendingFetch])

    const startFetch = useCallback(() => {
        const runtime = runtimeRef.current
        if (!runtime.enabled || activeFetchRef.current) return

        pendingFetchRef.current = null
        clearTrailingTimeout()

        const active: ActiveFetch = {
            scopeKey: runtime.scopeKey,
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
                    && currentRuntime.enabled
                    && currentRuntime.scopeKey === active.scopeKey
                    && currentScopeRef.current === active.scopeKey
                    && revisionRef.current === active.revision
                    && !active.superseded

                if (!mayApply) return

                authoritativeSuccessRef.current = true
                setState({
                    scopeKey: active.scopeKey,
                    data: result,
                    isLoading: false,
                    error: null,
                })
                resolveWaiters(active.scopeKey, active.sequence)
            })
            .catch((caughtError: unknown) => {
                const error = normalizeError(caughtError)
                const currentRuntime = runtimeRef.current
                const isQualifyingFailure = isMountedRef.current
                    && activeFetchRef.current === active
                    && currentRuntime.enabled
                    && currentRuntime.scopeKey === active.scopeKey
                    && currentScopeRef.current === active.scopeKey
                    && revisionRef.current === active.revision
                    && !active.superseded

                if (!isQualifyingFailure) return

                if (!authoritativeSuccessRef.current) {
                    setState((previous) => ({
                        scopeKey: active.scopeKey,
                        data: previous.scopeKey === active.scopeKey ? previous.data : currentRuntime.initialData,
                        isLoading: false,
                        error,
                    }))
                }
                rejectWaiters(active.scopeKey, active.sequence, error)
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

    const refetch = useCallback((): Promise<void> => {
        const runtime = runtimeRef.current
        if (!runtime.enabled) {
            return Promise.reject(new RealtimeScopeAbortError())
        }

        const active = activeFetchRef.current
        const minimumSequence = active?.scopeKey === runtime.scopeKey
            ? active.sequence + 1
            : fetchSequenceRef.current + 1

        const promise = new Promise<void>((resolve, reject) => {
            waitersRef.current.push({
                scopeKey: runtime.scopeKey,
                minimumSequence,
                resolve,
                reject,
            })
        })

        if (active?.scopeKey === runtime.scopeKey) {
            active.superseded = true
        }
        queueReconciliation(true)
        return promise
    }, [queueReconciliation])

    const markDataChanged = useCallback(() => {
        revisionRef.current += 1
        const active = activeFetchRef.current
        if (active?.scopeKey === runtimeRef.current.scopeKey) {
            active.superseded = true
        }
        queueReconciliation(false)
    }, [queueReconciliation])

    const mutate = useCallback((newData?: T[] | ((previous: T[]) => T[])) => {
        const runtime = runtimeRef.current
        if (!runtime.enabled) return

        if (newData === undefined) {
            runBackgroundRealtimeRefetch(refetch, 'manual mutation revalidation')
            return
        }

        markDataChanged()
        setState((previous) => {
            const previousData = previous.scopeKey === runtime.scopeKey
                ? previous.data
                : runtime.initialData
            const data = typeof newData === 'function'
                ? newData(previousData)
                : newData

            return {
                scopeKey: runtime.scopeKey,
                data,
                isLoading: previous.scopeKey === runtime.scopeKey
                    ? previous.isLoading
                    : true,
                error: previous.scopeKey === runtime.scopeKey
                    ? previous.error
                    : null,
            }
        })
    }, [markDataChanged, refetch])

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    const startPolling = useCallback(() => {
        const runtime = runtimeRef.current
        if (!runtime.enablePollingFallback || pollingRef.current) return

        pollingRef.current = setInterval(() => {
            const currentRuntime = runtimeRef.current
            if (
                !currentRuntime.enabled
                || activeFetchRef.current
                || pendingFetchRef.current
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
            const cancelledScope = currentScopeRef.current
            currentScopeRef.current = ''
            activeFetchRef.current = null
            pendingFetchRef.current = null
            clearTrailingTimeout()
            stopPolling()
            clearRetryTimeout()
            rejectScopeWaiters(cancelledScope)
        }
    }, [clearRetryTimeout, clearTrailingTimeout, rejectScopeWaiters, stopPolling])

    useEffect(() => {
        const previousScope = currentScopeRef.current
        if (previousScope === scopeKey) return

        rejectScopeWaiters(previousScope)
        const active = activeFetchRef.current
        if (active?.scopeKey === previousScope) {
            active.superseded = true
            activeFetchRef.current = null
        }
        pendingFetchRef.current = null
        clearTrailingTimeout()
        revisionRef.current = 0
        authoritativeSuccessRef.current = false
        currentScopeRef.current = scopeKey
        retryCountRef.current = 0
        stopPolling()
        clearRetryTimeout()
        setConnectionStatus(enabled ? 'connecting' : 'disconnected')
        setState({
            scopeKey,
            data: enabled ? runtimeRef.current.initialData : EMPTY_REALTIME_DATA,
            isLoading: enabled,
            error: null,
        })

        if (enabled) {
            startFetchRef.current()
        }
    }, [
        clearRetryTimeout,
        clearTrailingTimeout,
        enabled,
        rejectScopeWaiters,
        scopeKey,
        stopPolling,
    ])

    useEffect(() => {
        if (
            enabled
            && currentScopeRef.current === scopeKey
            && !authoritativeSuccessRef.current
            && !activeFetchRef.current
        ) {
            startFetchRef.current()
        }
    }, [enabled, scopeKey])

    useEffect(() => {
        if (!enabled || !subscriptionEnabled) {
            // Connection state follows subscription lifecycle rather than render state.
            // eslint-disable-next-line react-hooks/set-state-in-effect -- lifecycle synchronization
            setConnectionStatus(enabled ? 'connecting' : 'disconnected')
            retryCountRef.current = 0
            stopPolling()
            clearRetryTimeout()
            return
        }

        const subscriptionScope = scopeKey
        const supabase = createClient()
        const changesFilter = {
            event: '*',
            schema: 'public',
            table,
            ...(realtimeFilter ? { filter: realtimeFilter } : {}),
        } as const
        const channelName = `${table}-changes:${realtimeFilter ?? 'all'}:${subscriptionId}:${subscriptionNonce}`
        const channel = supabase
            .channel(channelName)
            .on<T>(
                'postgres_changes',
                changesFilter,
                (payload: RealtimePostgresChangesPayload<T>) => {
                    const runtime = runtimeRef.current
                    if (
                        !isMountedRef.current
                        || !runtime.enabled
                        || runtime.scopeKey !== subscriptionScope
                    ) {
                        return
                    }

                    markDataChanged()
                    if (payload.eventType === 'DELETE') {
                        setState((previous) => ({
                            scopeKey: subscriptionScope,
                            data: previous.scopeKey === subscriptionScope
                                ? previous.data.filter((item) => item.id !== (payload.old as T).id)
                                : runtime.initialData,
                            isLoading: previous.scopeKey === subscriptionScope
                                ? previous.isLoading
                                : true,
                            error: previous.scopeKey === subscriptionScope ? previous.error : null,
                        }))
                        return
                    }

                    const item = runtime.transformRealtimePayload
                        ? runtime.transformRealtimePayload(payload.new as Record<string, unknown>)
                        : payload.new as T
                    setState((previous) => {
                        const previousData = previous.scopeKey === subscriptionScope
                            ? previous.data
                            : runtime.initialData
                        const existingIndex = previousData.findIndex((current) => current.id === item.id)
                        const data = existingIndex === -1
                            ? runtime.insertPosition === 'prepend'
                                ? [item, ...previousData]
                                : [...previousData, item]
                            : previousData.map((current) => current.id === item.id ? item : current)

                        return {
                            scopeKey: subscriptionScope,
                            data,
                            isLoading: previous.scopeKey === subscriptionScope
                                ? previous.isLoading
                                : true,
                            error: previous.scopeKey === subscriptionScope ? previous.error : null,
                        }
                    })
                }
            )
            .subscribe((status) => {
                if (
                    !isMountedRef.current
                    || runtimeRef.current.scopeKey !== subscriptionScope
                ) {
                    return
                }

                if (status === 'SUBSCRIBED') {
                    retryCountRef.current = 0
                    clearRetryTimeout()
                    setConnectionStatus('connected')
                    stopPolling()
                    runBackgroundRealtimeRefetch(
                        refetch,
                        'realtime subscription synchronization'
                    )
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    startPolling()

                    if (retryCountRef.current < MAX_REALTIME_RETRIES) {
                        retryCountRef.current += 1
                        setConnectionStatus('connecting')
                        clearRetryTimeout()
                        retryTimeoutRef.current = setTimeout(() => {
                            if (!isMountedRef.current) return
                            setSubscriptionNonce((current) => current + 1)
                        }, Math.min(250 * retryCountRef.current, 1000))
                    } else {
                        clearRetryTimeout()
                        setConnectionStatus('disconnected')
                    }
                } else {
                    setConnectionStatus('connecting')
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
        scopeKey,
        startPolling,
        stopPolling,
        subscriptionId,
        subscriptionEnabled,
        subscriptionNonce,
        table,
    ])

    const exposedState = state.scopeKey === scopeKey
        ? state
        : {
            scopeKey,
            data: enabled ? initialData : [],
            isLoading: enabled,
            error: null,
        }

    return {
        data: enabled ? exposedState.data : [],
        isLoading: enabled ? exposedState.isLoading : false,
        error: enabled ? exposedState.error : null,
        connectionStatus: enabled ? connectionStatus : 'disconnected' as const,
        mutate,
        refetch,
    }
}

// Re-export types for convenience
export type { RealtimePostgresChangesPayload }
