/**
 * Epoch-scoped data ownership for the realtime hook: authoritative fetches,
 * explicit-refetch waiters, revisions, stale-fetch rejection, trailing
 * reconciliation, and optimistic-mutation fencing.
 *
 * Only this module modifies epoch-scoped data. Lifecycle ordering is owned by
 * the façade, which calls the phase functions returned here.
 */
import { useCallback, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type {
    ActiveFetch,
    FetchWaiter,
    PendingFetch,
    RealtimeScopeAccess,
    RealtimeState,
    RuntimeOptions,
    ScopedRevision,
    ScopedTimeout,
} from './types'

const RECONCILIATION_QUIET_MS = 250
const RECONCILIATION_MAX_WAIT_MS = 2000
export const EMPTY_REALTIME_DATA: never[] = []

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

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

interface UseRealtimeReconciliationOptions<T> {
    scopeAccess: RealtimeScopeAccess<T>
    scopeEpoch: number
    enabled: boolean
    initialData: T[]
}

export function useRealtimeReconciliation<T extends { id: string }>({
    scopeAccess,
    scopeEpoch,
    enabled,
    initialData,
}: UseRealtimeReconciliationOptions<T>) {
    const [state, setState] = useState<RealtimeState<T>>(() => ({
        epoch: scopeEpoch,
        data: enabled ? initialData : EMPTY_REALTIME_DATA,
        isLoading: enabled,
        error: null,
    }))

    const trailingTimeoutRef = useRef<ScopedTimeout | null>(null)
    const revisionRef = useRef<ScopedRevision>({ epoch: scopeEpoch, value: 0 })
    const authoritativeSuccessRef = useRef({ epoch: scopeEpoch, value: false })
    const fetchSequenceRef = useRef(0)
    const activeFetchRef = useRef<ActiveFetch | null>(null)
    const pendingFetchRef = useRef<PendingFetch | null>(null)
    const optimisticMutationsRef = useRef(new Map<symbol, number>())
    const waitersRef = useRef<FetchWaiter[]>([])
    const startFetchRef = useRef<() => void>(() => undefined)

    const clearTrailingTimeout = useCallback((expectedEpoch?: number) => {
        const trailing = trailingTimeoutRef.current
        if (!trailing || (expectedEpoch !== undefined && trailing.epoch !== expectedEpoch)) return

        clearTimeout(trailing.timeout)
        trailingTimeoutRef.current = null
    }, [])

    const clearOptimisticMutations = useCallback((preservedEpoch?: number) => {
        if (preservedEpoch === undefined) {
            optimisticMutationsRef.current.clear()
            return
        }

        for (const [token, tokenEpoch] of optimisticMutationsRef.current) {
            if (tokenEpoch !== preservedEpoch) {
                optimisticMutationsRef.current.delete(token)
            }
        }
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
        const pending = pendingFetchRef.current
        const runtime = scopeAccess.getRuntime()
        if (
            !pending
            || !runtime
            || scopeAccess.getCommittedEpoch() !== runtime.epoch
            || activeFetchRef.current
            || optimisticMutationsRef.current.size > 0
            || !runtime.enabled
            || pending.epoch !== runtime.epoch
        ) {
            return
        }

        clearTrailingTimeout()

        if (pending.freshnessRequired) {
            startFetchRef.current()
            return
        }

        const deadline = Math.min(
            pending.lastChangeAt + RECONCILIATION_QUIET_MS,
            pending.firstChangeAt + RECONCILIATION_MAX_WAIT_MS
        )
        const delay = Math.max(0, deadline - Date.now())
        const timeout = setTimeout(() => {
            if (trailingTimeoutRef.current?.timeout !== timeout) return
            trailingTimeoutRef.current = null
            if (
                scopeAccess.getRuntime()?.epoch !== pending.epoch
                || scopeAccess.getCommittedEpoch() !== pending.epoch
            ) return
            startFetchRef.current()
        }, delay)
        trailingTimeoutRef.current = { epoch: pending.epoch, timeout }
    }, [clearTrailingTimeout, scopeAccess])

    const queueReconciliation = useCallback((
        expectedEpoch: number,
        freshnessRequired: boolean,
        changedAt = Date.now()
    ) => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== expectedEpoch
            || scopeAccess.getCommittedEpoch() !== expectedEpoch
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
    }, [schedulePendingFetch, scopeAccess])

    const startFetch = useCallback(() => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || !runtime.enabled
            || scopeAccess.getCommittedEpoch() !== runtime.epoch
            || activeFetchRef.current
            || optimisticMutationsRef.current.size > 0
        ) return

        pendingFetchRef.current = null
        clearTrailingTimeout()

        const revision = revisionRef.current.epoch === runtime.epoch
            ? revisionRef.current.value
            : 0
        revisionRef.current = { epoch: runtime.epoch, value: revision }

        const active: ActiveFetch = {
            epoch: runtime.epoch,
            sequence: ++fetchSequenceRef.current,
            revision,
            superseded: false,
        }
        activeFetchRef.current = active
        const fetchForRequest = runtime.fetchFn

        void fetchForRequest()
            .then((result) => {
                const currentRuntime = scopeAccess.getRuntime()
                const mayApply = scopeAccess.isMounted()
                    && activeFetchRef.current === active
                    && currentRuntime !== null
                    && currentRuntime.enabled
                    && currentRuntime.epoch === active.epoch
                    && scopeAccess.getCommittedEpoch() === active.epoch
                    && revisionRef.current.epoch === active.epoch
                    && revisionRef.current.value === active.revision
                    && !active.superseded

                if (!mayApply) return

                authoritativeSuccessRef.current = { epoch: active.epoch, value: true }
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
                const currentRuntime = scopeAccess.getRuntime()
                const isQualifyingFailure = scopeAccess.isMounted()
                    && activeFetchRef.current === active
                    && currentRuntime !== null
                    && currentRuntime.enabled
                    && currentRuntime.epoch === active.epoch
                    && scopeAccess.getCommittedEpoch() === active.epoch
                    && revisionRef.current.epoch === active.epoch
                    && revisionRef.current.value === active.revision
                    && !active.superseded

                if (!isQualifyingFailure) return

                if (
                    authoritativeSuccessRef.current.epoch !== active.epoch
                    || !authoritativeSuccessRef.current.value
                ) {
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
    }, [clearTrailingTimeout, rejectWaiters, resolveWaiters, schedulePendingFetch, scopeAccess])

    // Async callbacks use this indirection so their identity remains stable.
    // eslint-disable-next-line react-hooks/refs -- intentional render-time scheduler refresh
    startFetchRef.current = startFetch

    const assertCurrentScope = useCallback(() => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || runtime.epoch !== scopeEpoch
            || scopeAccess.getCommittedEpoch() !== scopeEpoch
        ) {
            throw new RealtimeScopeAbortError()
        }
    }, [scopeAccess, scopeEpoch])

    const refetch = useCallback((): Promise<void> => {
        try {
            assertCurrentScope()
        } catch (error) {
            return Promise.reject(error)
        }

        const runtime = scopeAccess.getRuntime()
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
    }, [assertCurrentScope, queueReconciliation, scopeAccess, scopeEpoch])

    const markDataChanged = useCallback((
        expectedEpoch: number,
        scheduleReconciliation = true
    ) => {
        if (scopeAccess.getCommittedEpoch() !== expectedEpoch) return
        revisionRef.current = {
            epoch: expectedEpoch,
            value: revisionRef.current.epoch === expectedEpoch
                ? revisionRef.current.value + 1
                : 1,
        }
        const active = activeFetchRef.current
        if (active?.epoch === expectedEpoch) {
            active.superseded = true
        }
        if (scheduleReconciliation) {
            queueReconciliation(expectedEpoch, false)
        }
    }, [queueReconciliation, scopeAccess])

    const applyMutation = useCallback((
        expectedEpoch: number,
        newData: T[] | ((previous: T[]) => T[]),
        scheduleReconciliation: boolean
    ) => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== expectedEpoch
            || scopeAccess.getCommittedEpoch() !== expectedEpoch
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
    }, [markDataChanged, scopeAccess])

    const mutate = useCallback((newData?: T[] | ((previous: T[]) => T[])) => {
        if (scopeAccess.getCommittedEpoch() !== scopeEpoch) return
        if (newData === undefined) {
            runBackgroundRealtimeRefetch(refetch, 'manual mutation revalidation')
            return
        }

        applyMutation(scopeEpoch, newData, true)
    }, [applyMutation, refetch, scopeAccess, scopeEpoch])

    const mutateOptimistically = useCallback((
        newData: T[] | ((previous: T[]) => T[])
    ) => {
        const runtime = scopeAccess.getRuntime()
        if (
            !runtime
            || !runtime.enabled
            || runtime.epoch !== scopeEpoch
            || scopeAccess.getCommittedEpoch() !== scopeEpoch
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
                || scopeAccess.getCommittedEpoch() !== scopeEpoch
            ) return
            queueReconciliation(scopeEpoch, false)
        }
    }, [applyMutation, queueReconciliation, scopeAccess, scopeEpoch])

    /**
     * Applies a realtime row change. The caller has already verified that the
     * subscription and `runtime` belong to `epoch`.
     */
    const applyRealtimePayload = useCallback((
        epoch: number,
        payload: RealtimePostgresChangesPayload<T>,
        runtime: RuntimeOptions<T>
    ) => {
        markDataChanged(epoch)
        if (payload.eventType === 'DELETE') {
            setState((previous) => ({
                epoch,
                data: previous.epoch === epoch
                    ? previous.data.filter((item) => item.id !== (payload.old as T).id)
                    : runtime.initialData,
                isLoading: previous.epoch === epoch
                    ? previous.isLoading
                    : true,
                error: previous.epoch === epoch ? previous.error : null,
            }))
            return
        }

        let item: T
        try {
            item = runtime.transformRealtimePayload
                ? runtime.transformRealtimePayload(payload.new as Record<string, unknown>)
                : payload.new as T
        } catch (error) {
            // The change is already marked, so the queued refetch reconciles this row.
            console.error('[realtime] Skipped a malformed realtime row; awaiting reconciliation:', error)
            return
        }
        setState((previous) => {
            const previousData = previous.epoch === epoch
                ? previous.data
                : runtime.initialData
            const existingIndex = previousData.findIndex((current) => current.id === item.id)
            const data = existingIndex === -1
                ? runtime.insertPosition === 'prepend'
                    ? [item, ...previousData]
                    : [...previousData, item]
                : previousData.map((current) => current.id === item.id ? item : current)

            return {
                epoch,
                data,
                isLoading: previous.epoch === epoch
                    ? previous.isLoading
                    : true,
                error: previous.epoch === epoch ? previous.error : null,
            }
        })
    }, [markDataChanged])

    /** Polling tick: starts a fetch only when no other reconciliation is in flight. */
    const requestPollingFetch = useCallback((pollingEpoch: number) => {
        const currentRuntime = scopeAccess.getRuntime()
        if (
            !currentRuntime
            || currentRuntime.epoch !== pollingEpoch
            || scopeAccess.getCommittedEpoch() !== pollingEpoch
            || scopeAccess.getCommittedEpoch() !== currentRuntime.epoch
            || !currentRuntime.enabled
            || activeFetchRef.current
            || pendingFetchRef.current
            || optimisticMutationsRef.current.size > 0
        ) {
            return
        }
        startFetchRef.current()
    }, [scopeAccess])

    /** Unmount, first phase: invalidate in-flight work before subscription teardown. */
    const prepareUnmount = useCallback(() => {
        activeFetchRef.current = null
        pendingFetchRef.current = null
        clearOptimisticMutations()
        clearTrailingTimeout()
    }, [clearOptimisticMutations, clearTrailingTimeout])

    /** Unmount, final phase: reject explicit callers still waiting on the epoch. */
    const finishUnmount = useCallback((cancelledEpoch: number) => {
        rejectScopeWaiters(cancelledEpoch)
    }, [rejectScopeWaiters])

    /** Scope change, first phase: drop work that belongs to other epochs. */
    const prepareScopeChange = useCallback((previousEpoch: number, nextEpoch: number) => {
        rejectScopeWaiters(previousEpoch)
        const active = activeFetchRef.current
        if (active && active.epoch !== nextEpoch) {
            active.superseded = true
            activeFetchRef.current = null
        }
        if (pendingFetchRef.current && pendingFetchRef.current.epoch !== nextEpoch) {
            pendingFetchRef.current = null
        }
        clearOptimisticMutations(nextEpoch)
        const trailing = trailingTimeoutRef.current
        if (trailing && trailing.epoch !== nextEpoch) {
            clearTrailingTimeout(trailing.epoch)
        }
        if (revisionRef.current.epoch !== nextEpoch) {
            revisionRef.current = { epoch: nextEpoch, value: 0 }
        }
        if (authoritativeSuccessRef.current.epoch !== nextEpoch) {
            authoritativeSuccessRef.current = { epoch: nextEpoch, value: false }
        }
    }, [clearOptimisticMutations, clearTrailingTimeout, rejectScopeWaiters])

    /** Scope change, final phase: seed the new epoch's data and start its fetch. */
    const activateScope = useCallback((
        nextEpoch: number,
        nextEnabled: boolean,
        nextInitialData: T[]
    ) => {
        const runtime = scopeAccess.getRuntime()
        setState((previous) => previous.epoch === nextEpoch
            ? previous
            : {
                epoch: nextEpoch,
                data: nextEnabled ? runtime?.initialData ?? nextInitialData : EMPTY_REALTIME_DATA,
                isLoading: nextEnabled,
                error: null,
            })

        if (nextEnabled) {
            startFetchRef.current()
        }
    }, [scopeAccess])

    /** Starts the epoch's authoritative fetch unless one already succeeded or is running. */
    const ensureInitialFetch = useCallback((epoch: number, isEnabled: boolean) => {
        if (
            isEnabled
            && scopeAccess.getCommittedEpoch() === epoch
            && (
                authoritativeSuccessRef.current.epoch !== epoch
                || !authoritativeSuccessRef.current.value
            )
            && !activeFetchRef.current
        ) {
            startFetchRef.current()
        }
    }, [scopeAccess])

    return {
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
    }
}
