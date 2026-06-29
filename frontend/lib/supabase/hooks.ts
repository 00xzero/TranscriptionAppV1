/**
 * React hooks for Supabase data fetching with Realtime support.
 *
 * These hooks wrap the base realtime hook with specific table configurations.
 */
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import { useSupabaseRealtime } from './realtime'
import {
    fetchTranscripts,
    fetchTranscriptById,
    fetchTranscriptJobs,
    fetchSpeakers,
    deleteTranscript as deleteTranscriptQuery,
    updateTranscript as updateTranscriptQuery,
    createSpeaker as createSpeakerQuery,
    updateSpeaker as updateSpeakerQuery,
    deleteSpeaker as deleteSpeakerQuery,
} from './queries'
import type { Transcript, JobSummary, Speaker, SpeakerUpdate, TranscriptUpdate } from '@/contracts/db'

// ============================================================================
// Transcripts Hook
// ============================================================================

export interface AuthIdentity {
    /** Current authenticated user id, or null when signed out. */
    userId: string | null
    /**
     * True once Supabase has verified the current auth state. A cached browser
     * session may populate `userId` while this remains false; privacy-sensitive
     * callers (e.g. recording recovery) must wait for `ready`.
     */
    ready: boolean
}

/**
 * Authenticated identity with an explicit verification state. Exposes a cached
 * session user id early for low-risk UI responsiveness, but only marks `ready`
 * after getUser verifies the session (or confirms there is no signed-in user).
 */
export function useAuthIdentity(): AuthIdentity {
    const [identity, setIdentity] = useState<AuthIdentity>({ userId: null, ready: false })

    useEffect(() => {
        let isMounted = true
        const supabase = createClient()

        const loadUserId = async () => {
            try {
                const { data: sessionData } = await supabase.auth.getSession()
                if (!isMounted) return
                const sessionUserId = sessionData.session?.user.id ?? null
                setIdentity({ userId: sessionUserId, ready: false })

                const { data, error } = await supabase.auth.getUser()
                if (!isMounted) return
                setIdentity({
                    userId: error ? sessionUserId : data.user?.id ?? null,
                    ready: !error,
                })
            } catch {
                if (!isMounted) return
                setIdentity({ userId: null, ready: true })
            }
        }

        void loadUserId()

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (!isMounted) return
            if (event === 'INITIAL_SESSION') {
                setIdentity((current) =>
                    current.ready
                        ? current
                        : { userId: session?.user.id ?? null, ready: false }
                )
                return
            }
            setIdentity({ userId: session?.user.id ?? null, ready: true })
        })

        return () => {
            isMounted = false
            authListener.subscription.unsubscribe()
        }
    }, [])

    return identity
}

function useCurrentUserId() {
    return useAuthIdentity().userId
}

/**
 * Hook for fetching and subscribing to the transcripts list.
 * Uses Supabase Realtime with 5s polling fallback.
 */
export function useTranscriptsRealtime() {
    const userId = useCurrentUserId()
    const fetchFn = useCallback(() => fetchTranscripts(), [])

    const { data, isLoading, error, connectionStatus, mutate, refetch } =
        useSupabaseRealtime<Transcript>('transcripts', fetchFn, {
            realtimeFilter: userId ? `user_id=eq.${userId}` : null,
            subscriptionEnabled: Boolean(userId),
            enablePollingFallback: true,
            pollingInterval: 5000,
            insertPosition: 'prepend',
        })

    useEffect(() => {
        if (!userId) mutate([])
    }, [userId, mutate])

    // Action: Delete transcript with optimistic update
    const deleteTranscript = useCallback(
        async (id: string) => {
            // Capture previous data for rollback using functional update
            let previousData: Transcript[] = []
            mutate((current) => {
                previousData = current ?? []
                return previousData.filter((p) => p.id !== id)
            })

            try {
                await deleteTranscriptQuery(id)
            } catch (err) {
                // Rollback on error
                mutate(previousData)
                throw err
            }
        },
        [mutate]
    )

    return {
        transcripts: data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        refetch,
        deleteTranscript,
    }
}

// ============================================================================
// Single Transcript Hook (for Editor)
// ============================================================================

/**
 * Hook for fetching a single transcript.
 */
export function useTranscriptRealtime(transcriptId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!transcriptId) return []
        const transcript = await fetchTranscriptById(transcriptId)
        return transcript ? [transcript] : []
    }, [transcriptId])

    const { data, isLoading, error, mutate } = useSupabaseRealtime<Transcript>(
        'transcripts',
        fetchFn,
        {
            realtimeFilter: transcriptId ? `id=eq.${transcriptId}` : null,
            subscriptionEnabled: Boolean(transcriptId),
            enablePollingFallback: true,
        }
    )

    // Action: Update transcript
    const updateTranscript = useCallback(
        async (updates: TranscriptUpdate) => {
            if (!transcriptId) return

            // Capture previous data for rollback using functional update
            let previous: Transcript | null = null
            mutate((current) => {
                if (!current || current.length === 0) return current
                previous = current[0]
                return [{ ...previous, ...updates }]
            })

            // If there was no data to update, exit early
            if (!previous) return

            try {
                await updateTranscriptQuery(transcriptId, updates)
            } catch (err) {
                // Rollback on error
                if (previous) mutate([previous])
                throw err
            }
        },
        [transcriptId, mutate]
    )

    return {
        transcript: data[0] || null,
        isLoading,
        error,
        updateTranscript,
        refetch: () => mutate(),
    }
}

// ============================================================================
// Transcript Jobs Hook
// ============================================================================

/**
 * Hook for fetching jobs for a transcript.
 * Returns JobSummary (excludes payload) to avoid large JSON in browser.
 */
export function useTranscriptJobsRealtime(transcriptId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!transcriptId) return []
        return fetchTranscriptJobs(transcriptId)
    }, [transcriptId])

    // Transform realtime payloads to strip the large 'payload' field
    // Supabase Realtime sends full rows, which would reintroduce multi-MB JSON
    const transformRealtimePayload = useCallback((row: Record<string, unknown>): JobSummary => {
        const { payload: _payload, ...rest } = row
        return rest as JobSummary
    }, [])

    const { data, isLoading, error, refetch } = useSupabaseRealtime<JobSummary>(
        'jobs',
        fetchFn,
        {
            realtimeFilter: transcriptId ? `transcript_id=eq.${transcriptId}` : null,
            subscriptionEnabled: Boolean(transcriptId),
            enablePollingFallback: true,
            transformRealtimePayload,
            insertPosition: 'prepend',
        }
    )

    return {
        jobs: data,
        isLoading,
        error,
        refetch,
    }
}

// ============================================================================
// Speakers Hook (for Editor)
// ============================================================================

/**
 * Hook for fetching and managing speakers.
 */
export function useSpeakersRealtime(transcriptId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!transcriptId) return []
        return fetchSpeakers(transcriptId)
    }, [transcriptId])

    const { data, isLoading, error, mutate } = useSupabaseRealtime<Speaker>(
        'speakers',
        fetchFn,
        {
            realtimeFilter: transcriptId ? `transcript_id=eq.${transcriptId}` : null,
            subscriptionEnabled: Boolean(transcriptId),
            enablePollingFallback: true,
        }
    )

    // Action: Create speaker
    const createSpeaker = useCallback(
        async (label: string) => {
            if (!transcriptId) throw new Error('No transcript ID')
            const newSpeaker = await createSpeakerQuery(transcriptId, label)
            // Use functional mutate to prevent duplicates from Realtime echoes
            mutate((prev) => {
                if (!prev) return [newSpeaker]
                // Check if speaker already exists (from Realtime INSERT echo)
                if (prev.some((s) => s.id === newSpeaker.id)) return prev
                return [...prev, newSpeaker]
            })
            return newSpeaker
        },
        [transcriptId, mutate]
    )

    // Action: Update speaker with optimistic update
    const updateSpeaker = useCallback(
        async (id: string, updates: SpeakerUpdate) => {
            // Capture previous data for rollback using functional update
            let previous: Speaker[] = []
            mutate((current) => {
                previous = current ?? []
                return previous.map((s) => (s.id === id ? { ...s, ...updates } : s))
            })

            try {
                await updateSpeakerQuery(id, updates)
            } catch (err) {
                mutate(previous)
                throw err
            }
        },
        [mutate]
    )

    // Action: Delete speaker
    const deleteSpeaker = useCallback(
        async (id: string) => {
            // Capture previous data for rollback using functional update
            let previous: Speaker[] = []
            mutate((current) => {
                previous = current ?? []
                return previous.filter((s) => s.id !== id)
            })

            try {
                await deleteSpeakerQuery(id)
            } catch (err) {
                mutate(previous)
                throw err
            }
        },
        [mutate]
    )

    return {
        speakers: data,
        isLoading,
        error,
        createSpeaker,
        updateSpeaker,
        deleteSpeaker,
        mutate,
    }
}
