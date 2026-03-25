/**
 * Supabase Realtime subscription hooks for live data updates.
 *
 * Primary mechanism for data fetching with 5s polling fallback
 * when realtime subscription fails.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/infra/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

type TableName = 'projects' | 'jobs' | 'chunks' | 'speakers'

interface UseRealtimeOptions<T> {
    /** Initial data to display while loading */
    initialData?: T[]
    /** Enable 5s polling fallback when realtime fails */
    enablePollingFallback?: boolean
    /** Custom polling interval in ms (default: 5000) */
    pollingInterval?: number
    /** Transform function to strip unwanted fields from realtime payloads */
    transformRealtimePayload?: (row: Record<string, unknown>) => T
}

/**
 * Hook for subscribing to realtime changes on a table with polling fallback.
 */
export function useSupabaseRealtime<T extends { id: string }>(
    table: TableName,
    fetchFn: () => Promise<T[]>,
    options: UseRealtimeOptions<T> = {}
) {
    const { initialData = [], enablePollingFallback = true, pollingInterval = 5000, transformRealtimePayload } = options

    const [data, setData] = useState<T[]>(initialData)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')

    const channelRef = useRef<RealtimeChannel | null>(null)
    const pollingRef = useRef<NodeJS.Timeout | null>(null)
    const isMountedRef = useRef(true)

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

    // Setup realtime subscription
    useEffect(() => {
        isMountedRef.current = true
        const supabase = createClient()

        // Initial fetch
        fetchData()

        // Setup realtime channel
        const channel = supabase
            .channel(`${table}-changes`)
            .on<T>(
                'postgres_changes',
                { event: '*', schema: 'public', table },
                (payload: RealtimePostgresChangesPayload<T>) => {
                    if (!isMountedRef.current) return

                    if (payload.eventType === 'INSERT') {
                        const newItem = transformRealtimePayload 
                            ? transformRealtimePayload(payload.new as Record<string, unknown>)
                            : payload.new as T
                        setData(prev => [...prev, newItem])
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedItem = transformRealtimePayload
                            ? transformRealtimePayload(payload.new as Record<string, unknown>)
                            : payload.new as T
                        setData(prev =>
                            prev.map(item =>
                                item.id === updatedItem.id ? updatedItem : item
                            )
                        )
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
                    setConnectionStatus('connected')
                    // Keep polling as backup even when connected, but at a slower rate
                    // This ensures we never miss updates due to realtime timing issues
                    stopPolling()
                    if (enablePollingFallback) {
                        pollingRef.current = setInterval(() => {
                            fetchData()
                        }, pollingInterval * 2) // Poll at half the frequency when realtime is active
                    }
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    setConnectionStatus('disconnected')
                    startPolling() // Start aggressive polling fallback
                } else {
                    setConnectionStatus('connecting')
                    startPolling() // Also poll while connecting to catch any missed updates
                }
            })

        channelRef.current = channel

        return () => {
            isMountedRef.current = false
            stopPolling()
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current)
                channelRef.current = null
            }
        }
    }, [table, fetchData, startPolling, stopPolling, enablePollingFallback, pollingInterval])

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
