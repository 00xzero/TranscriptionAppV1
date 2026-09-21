/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Realtime is the primary update mechanism. Polling is only an opportunistic
 * fallback while the channel is unavailable.
 *
 * This façade owns scope identity and lifecycle ordering. Epoch-scoped data
 * lives in `reconciliation.ts`; channel, polling, and retry ownership lives in
 * `subscription.ts`. All four passive effects stay here so their registration
 * order, and the order of each phase within them, is unchanged.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { EMPTY_REALTIME_DATA, useRealtimeReconciliation } from './reconciliation'
import { useRealtimeSubscription } from './subscription'
import type {
    RealtimeScopeAccess,
    RuntimeOptions,
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

    const subscriptionId = useId().replaceAll(':', '')
    const {
        connectionState,
        stop,
        resetScope,
        connect,
    } = useRealtimeSubscription<T>({
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
    })

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
            const cancelledEpoch = initializedEpochRef.current
            prepareUnmount()
            stop()
            finishUnmount(cancelledEpoch)
        }
    }, [finishUnmount, prepareUnmount, stop])

    useEffect(() => {
        const previousEpoch = initializedEpochRef.current
        if (previousEpoch === scopeEpoch) return

        prepareScopeChange(previousEpoch, scopeEpoch)
        initializedEpochRef.current = scopeEpoch
        resetScope(scopeEpoch, enabled)
        activateScope(scopeEpoch, enabled, initialData)
    }, [
        activateScope,
        enabled,
        initialData,
        prepareScopeChange,
        resetScope,
        scopeEpoch,
    ])

    useEffect(() => {
        ensureInitialFetch(scopeEpoch, enabled)
    }, [enabled, ensureInitialFetch, scopeEpoch])

    useEffect(() => connect(), [connect])

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
