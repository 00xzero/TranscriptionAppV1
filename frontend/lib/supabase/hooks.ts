/**
 * React hooks for Supabase data fetching with Realtime support.
 *
 * These hooks wrap the base realtime hook with specific table configurations.
 */
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import { useSupabaseRealtime } from './realtime'
import {
    fetchProjects,
    fetchProjectById,
    fetchProjectJobs,
    fetchSpeakers,
    deleteProject as deleteProjectQuery,
    updateProject as updateProjectQuery,
    createSpeaker as createSpeakerQuery,
    updateSpeaker as updateSpeakerQuery,
    deleteSpeaker as deleteSpeakerQuery,
} from './queries'
import type { Project, JobSummary, Speaker, SpeakerUpdate, ProjectUpdate } from '@/contracts/db'

// ============================================================================
// Projects Hook
// ============================================================================

function useCurrentUserId() {
    const [userId, setUserId] = useState<string | null>(null)

    useEffect(() => {
        let isMounted = true
        const supabase = createClient()

        supabase.auth.getUser().then(({ data, error }) => {
            if (!isMounted) return
            setUserId(error ? null : data.user?.id ?? null)
        })

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!isMounted) return
            setUserId(session?.user.id ?? null)
        })

        return () => {
            isMounted = false
            authListener.subscription.unsubscribe()
        }
    }, [])

    return userId
}

/**
 * Hook for fetching and subscribing to the projects list.
 * Uses Supabase Realtime with 5s polling fallback.
 */
export function useProjectsRealtime() {
    const userId = useCurrentUserId()
    const fetchFn = useCallback(() => fetchProjects(), [])

    const { data, isLoading, error, connectionStatus, mutate, refetch } =
        useSupabaseRealtime<Project>('projects', fetchFn, {
            realtimeFilter: userId ? `user_id=eq.${userId}` : null,
            subscriptionEnabled: Boolean(userId),
            enablePollingFallback: true,
            pollingInterval: 5000,
        })

    useEffect(() => {
        if (!userId) mutate([])
    }, [userId, mutate])

    // Action: Delete project with optimistic update
    const deleteProject = useCallback(
        async (id: string) => {
            // Capture previous data for rollback using functional update
            let previousData: Project[] = []
            mutate((current) => {
                previousData = current ?? []
                return previousData.filter((p) => p.id !== id)
            })

            try {
                await deleteProjectQuery(id)
            } catch (err) {
                // Rollback on error
                mutate(previousData)
                throw err
            }
        },
        [mutate]
    )

    return {
        projects: data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        refetch,
        deleteProject,
    }
}

// ============================================================================
// Single Project Hook (for Editor)
// ============================================================================

/**
 * Hook for fetching a single project.
 */
export function useProjectRealtime(projectId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!projectId) return []
        const project = await fetchProjectById(projectId)
        return project ? [project] : []
    }, [projectId])

    const { data, isLoading, error, mutate } = useSupabaseRealtime<Project>(
        'projects',
        fetchFn,
        {
            realtimeFilter: projectId ? `id=eq.${projectId}` : null,
            subscriptionEnabled: Boolean(projectId),
            enablePollingFallback: true,
        }
    )

    // Action: Update project
    const updateProject = useCallback(
        async (updates: ProjectUpdate) => {
            if (!projectId) return

            // Capture previous data for rollback using functional update
            let previous: Project | null = null
            mutate((current) => {
                if (!current || current.length === 0) return current
                previous = current[0]
                return [{ ...previous, ...updates }]
            })

            // If there was no data to update, exit early
            if (!previous) return

            try {
                await updateProjectQuery(projectId, updates)
            } catch (err) {
                // Rollback on error
                if (previous) mutate([previous])
                throw err
            }
        },
        [projectId, mutate]
    )

    return {
        project: data[0] || null,
        isLoading,
        error,
        updateProject,
        refetch: () => mutate(),
    }
}

// ============================================================================
// Project Jobs Hook
// ============================================================================

/**
 * Hook for fetching jobs for a project.
 * Returns JobSummary (excludes payload) to avoid large JSON in browser.
 */
export function useProjectJobsRealtime(projectId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!projectId) return []
        return fetchProjectJobs(projectId)
    }, [projectId])

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
            realtimeFilter: projectId ? `project_id=eq.${projectId}` : null,
            subscriptionEnabled: Boolean(projectId),
            enablePollingFallback: true,
            transformRealtimePayload,
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
export function useSpeakersRealtime(projectId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!projectId) return []
        return fetchSpeakers(projectId)
    }, [projectId])

    const { data, isLoading, error, mutate } = useSupabaseRealtime<Speaker>(
        'speakers',
        fetchFn,
        {
            realtimeFilter: projectId ? `project_id=eq.${projectId}` : null,
            subscriptionEnabled: Boolean(projectId),
            enablePollingFallback: true,
        }
    )

    // Action: Create speaker
    const createSpeaker = useCallback(
        async (label: string) => {
            if (!projectId) throw new Error('No project ID')
            const newSpeaker = await createSpeakerQuery(projectId, label)
            // Use functional mutate to prevent duplicates from Realtime echoes
            mutate((prev) => {
                if (!prev) return [newSpeaker]
                // Check if speaker already exists (from Realtime INSERT echo)
                if (prev.some((s) => s.id === newSpeaker.id)) return prev
                return [...prev, newSpeaker]
            })
            return newSpeaker
        },
        [projectId, mutate]
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
