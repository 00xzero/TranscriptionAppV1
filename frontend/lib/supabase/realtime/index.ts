/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Realtime is the primary update mechanism. Polling is only an opportunistic
 * fallback while the channel is unavailable.
 *
 * This façade owns scope identity and lifecycle ordering. Epoch-scoped data
 * lives in `reconciliation.ts`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import {
    EMPTY_REALTIME_DATA,
    runBackgroundRealtimeRefetch,
    useRealtimeReconciliation,
} from './reconciliation'
import type {
    RealtimeScopeAccess,
    RuntimeOptions,
    ScopedConnectionStatus,
    ScopeIdentity,
    TableName,
    UseRealtimeOptions,
} from './types'

export type { ConnectionStatus } from './types'
export {
    RealtimeScopeAbortError,
    isRealtimeScopeAbortError,
    runBackgroundRealtimeRefetch,
} from './reconciliation'

const MAX_REALTIME_RETRIES = 5

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

    const isMountedRef = useRef(false)
    const initializedEpochRef = useRef(scopeEpoch)
    const scopeAccess = useMemo<RealtimeScopeAccess<T>>(() => ({
        getRuntime: () => runtimeRef.current,
        getCommittedEpoch: () => committedEpochRef.current,
        isMounted: () => isMountedRef.current,
    }), [])

    const {
        state,
        refetch,
        mutate,
        mutateOptimistically,
        assertCurrentScope,
        applyRealtimePayload,
        requestPollingFetch,
        prepareUnmount,
        finishUnmount,
        prepareScopeChange,
        activateScope,
        ensureInitialFetch,
    } = useRealtimeReconciliation<T>({ scopeAccess, scopeEpoch, enabled, initialData })

    const channelRef = useRef<RealtimeChannel | null>(null)
    const subscriptionLifecycleRef = useRef<symbol | null>(null)
    const subscriptionRunRef = useRef(0)
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)
    const subscriptionId = useId().replaceAll(':', '')

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
            requestPollingFetch(pollingEpoch)
        }, runtime.pollingInterval)
    }, [requestPollingFetch])

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
            prepareUnmount()
            stopPolling()
            clearRetryTimeout()
            finishUnmount(cancelledEpoch)
        }
    }, [
        clearRetryTimeout,
        finishUnmount,
        prepareUnmount,
        stopPolling,
    ])

    useEffect(() => {
        const previousEpoch = initializedEpochRef.current
        if (previousEpoch === scopeEpoch) return

        prepareScopeChange(previousEpoch, scopeEpoch)
        initializedEpochRef.current = scopeEpoch
        retryCountRef.current = 0
        stopPolling()
        clearRetryTimeout()
        setConnectionState((previous) => previous.epoch === scopeEpoch
            ? previous
            : {
                epoch: scopeEpoch,
                status: enabled ? 'connecting' : 'disconnected',
            })
        activateScope(scopeEpoch, enabled, initialData)
    }, [
        activateScope,
        clearRetryTimeout,
        enabled,
        initialData,
        prepareScopeChange,
        scopeEpoch,
        stopPolling,
    ])

    useEffect(() => {
        ensureInitialFetch(scopeEpoch, enabled)
    }, [enabled, ensureInitialFetch, scopeEpoch])

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
        const subscriptionRun = ++subscriptionRunRef.current
        const subscriptionLifecycle = Symbol('realtime-subscription')
        subscriptionLifecycleRef.current = subscriptionLifecycle
        const supabase = createClient()
        const changesFilter = {
            event: '*',
            schema: 'public',
            table,
            ...(realtimeFilter ? { filter: realtimeFilter } : {}),
        } as const
        const channelName = `${table}-changes:${realtimeFilter ?? 'all'}:${subscriptionId}:${subscriptionEpoch}:${subscriptionNonce}:${subscriptionRun}`
        const channel = supabase
            .channel(channelName)
            .on<T>(
                'postgres_changes',
                changesFilter,
                (payload: RealtimePostgresChangesPayload<T>) => {
                    const runtime = runtimeRef.current
                    if (
                        !isMountedRef.current
                        || subscriptionLifecycleRef.current !== subscriptionLifecycle
                        || !runtime
                        || !runtime.enabled
                        || runtime.epoch !== subscriptionEpoch
                        || committedEpochRef.current !== subscriptionEpoch
                    ) {
                        return
                    }

                    applyRealtimePayload(subscriptionEpoch, payload, runtime)
                }
            )
            .subscribe((status) => {
                if (
                    !isMountedRef.current
                    || subscriptionLifecycleRef.current !== subscriptionLifecycle
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
                                || subscriptionLifecycleRef.current !== subscriptionLifecycle
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
            if (subscriptionLifecycleRef.current === subscriptionLifecycle) {
                subscriptionLifecycleRef.current = null
            }
            void supabase.removeChannel(channel)
        }
    }, [
        applyRealtimePayload,
        clearRetryTimeout,
        enabled,
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
            data: enabled ? initialData : EMPTY_REALTIME_DATA,
            isLoading: enabled,
            error: null,
        }

    return {
        data: enabled ? exposedState.data : EMPTY_REALTIME_DATA,
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
