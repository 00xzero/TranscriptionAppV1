/**
 * React hooks for Supabase data fetching with Realtime support.
 *
 * These hooks wrap the base realtime hook with specific table configurations.
 */
import { useCallback } from 'react'
import { useSupabaseRealtime } from './realtime'
import {
    fetchProjects,
    fetchProjectById,
    fetchProjectJobs,
    fetchChunks,
    fetchSpeakers,
    deleteProject as deleteProjectQuery,
    updateProject as updateProjectQuery,
    updateChunk as updateChunkQuery,
    createSpeaker as createSpeakerQuery,
    updateSpeaker as updateSpeakerQuery,
    deleteSpeaker as deleteSpeakerQuery,
} from './queries'
import type { Project, Job, Chunk, Speaker, ChunkUpdate, SpeakerUpdate, ProjectUpdate } from './types'

// ============================================================================
// Projects Hook
// ============================================================================

/**
 * Hook for fetching and subscribing to the projects list.
 * Uses Supabase Realtime with 5s polling fallback.
 */
export function useProjectsRealtime() {
    const fetchFn = useCallback(() => fetchProjects(), [])

    const { data, isLoading, error, connectionStatus, mutate, refetch } =
        useSupabaseRealtime<Project>('projects', fetchFn, {
            enablePollingFallback: true,
            pollingInterval: 5000,
        })

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
        { enablePollingFallback: true }
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
 */
export function useProjectJobsRealtime(projectId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!projectId) return []
        return fetchProjectJobs(projectId)
    }, [projectId])

    const { data, isLoading, error, refetch } = useSupabaseRealtime<Job>(
        'jobs',
        fetchFn,
        { enablePollingFallback: true }
    )

    return {
        jobs: data,
        isLoading,
        error,
        refetch,
    }
}

// ============================================================================
// Chunks Hook (for Editor)
// ============================================================================

/**
 * Hook for fetching and managing chunks.
 */
export function useChunksRealtime(projectId: string | null) {
    const fetchFn = useCallback(async () => {
        if (!projectId) return []
        return fetchChunks(projectId)
    }, [projectId])

    const { data, isLoading, error, mutate } = useSupabaseRealtime<Chunk>(
        'chunks',
        fetchFn,
        { enablePollingFallback: true }
    )

    // Action: Update chunk with optimistic update
    const updateChunk = useCallback(
        async (id: string, updates: ChunkUpdate) => {
            const previous = data
            // Optimistic update
            mutate(
                data.map((c) => (c.id === id ? { ...c, ...updates, is_edited: true } : c))
            )

            try {
                await updateChunkQuery(id, updates)
            } catch (err) {
                mutate(previous)
                throw err
            }
        },
        [data, mutate]
    )

    return {
        chunks: data,
        isLoading,
        error,
        updateChunk,
        mutate,
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
        { enablePollingFallback: true }
    )

    // Action: Create speaker
    const createSpeaker = useCallback(
        async (label: string) => {
            if (!projectId) throw new Error('No project ID')
            const newSpeaker = await createSpeakerQuery(projectId, label)
            mutate([...data, newSpeaker])
            return newSpeaker
        },
        [projectId, data, mutate]
    )

    // Action: Update speaker with optimistic update
    const updateSpeaker = useCallback(
        async (id: string, updates: SpeakerUpdate) => {
            const previous = data
            mutate(data.map((s) => (s.id === id ? { ...s, ...updates } : s)))

            try {
                await updateSpeakerQuery(id, updates)
            } catch (err) {
                mutate(previous)
                throw err
            }
        },
        [data, mutate]
    )

    // Action: Delete speaker
    const deleteSpeaker = useCallback(
        async (id: string) => {
            const previous = data
            mutate(data.filter((s) => s.id !== id))

            try {
                await deleteSpeakerQuery(id)
            } catch (err) {
                mutate(previous)
                throw err
            }
        },
        [data, mutate]
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
