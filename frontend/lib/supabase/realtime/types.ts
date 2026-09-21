/**
 * Internal types shared by the realtime façade and its modules.
 */

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export type TableName = 'transcripts' | 'projects' | 'jobs' | 'speakers'
export type InsertPosition = 'append' | 'prepend'

export interface UseRealtimeOptions<T> {
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

export interface RealtimeState<T> {
    epoch: number
    data: T[]
    isLoading: boolean
    error: Error | null
}

export interface ScopedConnectionStatus {
    epoch: number
    status: ConnectionStatus
}

export interface FetchWaiter {
    epoch: number
    minimumSequence: number
    resolve: () => void
    reject: (error: Error) => void
}

export interface ActiveFetch {
    epoch: number
    sequence: number
    revision: number
    superseded: boolean
}

export interface PendingFetch {
    epoch: number
    freshnessRequired: boolean
    firstChangeAt: number
    lastChangeAt: number
}

export interface ScopedTimeout {
    epoch: number
    timeout: ReturnType<typeof setTimeout>
}

export interface ScopedRevision {
    epoch: number
    value: number
}

export interface RuntimeOptions<T> {
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

export interface ScopeIdentity {
    descriptor: string
    epoch: number
}

/**
 * Read-only view of façade-owned scope state. Referentially stable for the
 * lifetime of the hook, so modules may list it as a callback dependency.
 */
export interface RealtimeScopeAccess<T> {
    getRuntime: () => RuntimeOptions<T> | null
    getCommittedEpoch: () => number | null
    isMounted: () => boolean
}
