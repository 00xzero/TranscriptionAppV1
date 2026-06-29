/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Primary mechanism for data fetching with 5s polling fallback
 * when realtime is unavailable.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/infra/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

type TableName = 'transcripts' | 'jobs' | 'speakers'
type InsertPosition = 'append' | 'prepend'
let nextSubscriptionId = 0
const MAX_REALTIME_RETRIES = 5

interface UseRealtimeOptions<T> {
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

/**
 * Hook for subscribing to realtime changes on a table with polling fallback.
 */
export function useSupabaseRealtime<T extends { id: string }>(
    table: TableName,
    fetchFn: () => Promise<T[]>,
    options: UseRealtimeOptions<T> = {}
) {
    const {
        initialData = [],
        realtimeFilter,
        subscriptionEnabled = true,
        enablePollingFallback = true,
        pollingInterval = 5000,
        transformRealtimePayload,
        insertPosition = 'append',
    } = options

    const [data, setData] = useState<T[]>(initialData)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
    const [subscriptionNonce, setSubscriptionNonce] = useState(0)

    const channelRef = useRef<RealtimeChannel | null>(null)
    const pollingRef = useRef<NodeJS.Timeout | null>(null)
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryCountRef = useRef(0)
    const isMountedRef = useRef(true)
    const subscriptionIdRef = useRef<number | null>(null)

    if (subscriptionIdRef.current === null) {
        nextSubscriptionId += 1
        subscriptionIdRef.current = nextSubscriptionId
    }

    // Fetch data function
    const fetchData = useCallback(async () => {
        try {
            const result = await fetchFn()
            if (isMountedRef.current) {
                setData(result)
                setError(null)
            }
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err : new Error(String(err)))
            }
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false)
            }
        }
    }, [fetchFn])

    // Mutate function for optimistic updates
    const mutate = useCallback((newData?: T[] | ((prev: T[]) => T[])) => {
        if (newData === undefined) {
            // Revalidate from server
            fetchData()
        } else if (typeof newData === 'function') {
            setData(newData)
        } else {
            setData(newData)
        }
    }, [fetchData])

    // Start polling fallback
    const startPolling = useCallback(() => {
        if (!enablePollingFallback) return
        if (pollingRef.current) return // Already polling

        pollingRef.current = setInterval(() => {
            fetchData()
        }, pollingInterval)
    }, [enablePollingFallback, pollingInterval, fetchData])

    // Stop polling
    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = null
        }
    }, [])

    const mergeItem = useCallback((prev: T[], item: T) => {
        const existingIndex = prev.findIndex((current) => current.id === item.id)
        if (existingIndex !== -1) {
            return prev.map((current) => current.id === item.id ? item : current)
        }

        return insertPosition === 'prepend' ? [item, ...prev] : [...prev, item]
    }, [insertPosition])

    // Setup realtime subscription
    useEffect(() => {
        isMountedRef.current = true
        const supabase = createClient()

        // Initial fetch
        fetchData()

        if (!subscriptionEnabled) {
            setConnectionStatus('connecting')
            retryCountRef.current = 0
            clearRetryTimeout()
            return () => {
                isMountedRef.current = false
                stopPolling()
                clearRetryTimeout()
            }
        }

        const changesFilter = {
            event: '*',
            schema: 'public',
            table,
            ...(realtimeFilter ? { filter: realtimeFilter } : {}),
        } as const

        // Setup realtime channel
        const channelName = `${table}-changes:${realtimeFilter ?? 'all'}:${subscriptionIdRef.current}:${subscriptionNonce}`
        const channel = supabase
            .channel(channelName)
            .on<T>(
                'postgres_changes',
                changesFilter,
                (payload: RealtimePostgresChangesPayload<T>) => {
                    if (!isMountedRef.current) return

                    if (payload.eventType === 'INSERT') {
                        const newItem = transformRealtimePayload 
                            ? transformRealtimePayload(payload.new as Record<string, unknown>)
                            : payload.new as T
                        setData(prev => mergeItem(prev, newItem))
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedItem = transformRealtimePayload
                            ? transformRealtimePayload(payload.new as Record<string, unknown>)
                            : payload.new as T
                        setData(prev => mergeItem(prev, updatedItem))
                    } else if (payload.eventType === 'DELETE') {
                        setData(prev =>
                            prev.filter(item => item.id !== (payload.old as T).id)
                        )
                    }
                }
            )
            .subscribe((status) => {
                if (!isMountedRef.current) return

                if (status === 'SUBSCRIBED') {
                    retryCountRef.current = 0
                    clearRetryTimeout()
                    setConnectionStatus('connected')
                    stopPolling()
                    fetchData()
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    startPolling() // Start aggressive polling fallback

                    // retryCountRef increments up to MAX_REALTIME_RETRIES, with retryTimeoutRef scheduling setSubscriptionNonce reconnects after clearRetryTimeout using 250ms backoff steps capped at 1000ms; once retries are exhausted, setConnectionStatus marks disconnected.
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
                    startPolling() // Also poll while connecting to catch any missed updates
                }
            })

        channelRef.current = channel

        return () => {
            isMountedRef.current = false
            stopPolling()
            clearRetryTimeout()
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current)
                channelRef.current = null
            }
        }
    }, [
        table,
        realtimeFilter,
        subscriptionEnabled,
        subscriptionNonce,
        fetchData,
        startPolling,
        stopPolling,
        clearRetryTimeout,
        enablePollingFallback,
        pollingInterval,
        transformRealtimePayload,
        mergeItem,
    ])

    return {
        data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        refetch: fetchData,
    }
}

// Re-export types for convenience
export type { RealtimePostgresChangesPayload }
