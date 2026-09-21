/**
 * Supabase channel ownership for the realtime hook: connection status,
 * payload forwarding, polling fallback, bounded retries, and cleanup.
 *
 * Row changes are forwarded to reconciliation; this module never touches
 * epoch-scoped data. The façade decides when `connect`, `resetScope`, and
 * `stop` run.
 */
import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { runBackgroundRealtimeRefetch } from './reconciliation'
import type {
    RealtimeScopeAccess,
    RuntimeOptions,
    ScopedConnectionStatus,
    TableName,
} from './types'

const MAX_REALTIME_RETRIES = 5

interface UseRealtimeSubscriptionOptions<T extends { id: string }> {
    scopeAccess: RealtimeScopeAccess<T>
    scopeEpoch: number
    enabled: boolean
    subscriptionEnabled: boolean
    table: TableName
    realtimeFilter: string | null | undefined
    subscriptionId: string
    applyRealtimePayload: (
        epoch: number,
        payload: RealtimePostgresChangesPayload<T>,
        runtime: RuntimeOptions<T>
    ) => void
    refetch: () => Promise<void>
    requestPollingFetch: (pollingEpoch: number) => void
}

export function useRealtimeSubscription<T extends { id: string }>({
    scopeAccess,
    scopeEpoch,
    enabled,
    subscriptionEnabled,
    table,
    realtimeFilter,
    subscriptionId,
    applyRealtimePayload,
    refetch,
    requestPollingFetch,
}: UseRealtimeSubscriptionOptions<T>) {
    const [connectionState, setConnectionState] = useState<ScopedConnectionStatus>(() => ({
        epoch: scopeEpoch,
        status: enabled ? 'connecting' : 'disconnected',
    }))
    const [subscriptionNonce, setSubscriptionNonce] = useState(0)

    const channelRef = useRef<RealtimeChannel | null>(null)
    const subscriptionLifecycleRef = useRef<symbol | null>(null)
    const subscriptionRunRef = useRef(0)
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    const startPolling = useCallback(() => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || scopeAccess.getCommittedEpoch() !== runtime.epoch
            || !runtime.enablePollingFallback
            || pollingRef.current
        ) return

        const pollingEpoch = runtime.epoch
        pollingRef.current = setInterval(() => {
            requestPollingFetch(pollingEpoch)
        }, runtime.pollingInterval)
    }, [requestPollingFetch, scopeAccess])

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = null
        }
    }, [])

    /** Unmount: release polling and retry timers. */
    const stop = useCallback(() => {
        stopPolling()
        clearRetryTimeout()
    }, [clearRetryTimeout, stopPolling])

    /** Scope change: reset retries and timers and report the new epoch's status. */
    const resetScope = useCallback((nextEpoch: number, nextEnabled: boolean) => {
        retryCountRef.current = 0
        stopPolling()
        clearRetryTimeout()
        setConnectionState((previous) => previous.epoch === nextEpoch
            ? previous
            : {
                epoch: nextEpoch,
                status: nextEnabled ? 'connecting' : 'disconnected',
            })
    }, [clearRetryTimeout, stopPolling])

    /**
     * Opens the channel for the current scope and returns its cleanup. Its
     * identity changes exactly when the subscription must be recreated.
     */
    const connect = useCallback(() => {
        if (!enabled || !subscriptionEnabled) {
            // Connection state follows subscription lifecycle rather than render state.
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
                    const runtime = scopeAccess.getRuntime()
                    if (
                        !scopeAccess.isMounted()
                        || subscriptionLifecycleRef.current !== subscriptionLifecycle
                        || !runtime
                        || !runtime.enabled
                        || runtime.epoch !== subscriptionEpoch
                        || scopeAccess.getCommittedEpoch() !== subscriptionEpoch
                    ) {
                        return
                    }

                    applyRealtimePayload(subscriptionEpoch, payload, runtime)
                }
            )
            .subscribe((status) => {
                if (
                    !scopeAccess.isMounted()
                    || subscriptionLifecycleRef.current !== subscriptionLifecycle
                    || scopeAccess.getRuntime()?.epoch !== subscriptionEpoch
                    || scopeAccess.getCommittedEpoch() !== subscriptionEpoch
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
                                !scopeAccess.isMounted()
                                || subscriptionLifecycleRef.current !== subscriptionLifecycle
                                || scopeAccess.getRuntime()?.epoch !== subscriptionEpoch
                                || scopeAccess.getCommittedEpoch() !== subscriptionEpoch
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
        scopeAccess,
        scopeEpoch,
        startPolling,
        stopPolling,
        subscriptionId,
        subscriptionEnabled,
        subscriptionNonce,
        table,
    ])

    return {
        connectionState,
        stop,
        resetScope,
        connect,
    }
}
