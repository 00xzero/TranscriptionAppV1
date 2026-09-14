/**
 * React hooks for Supabase data fetching with Realtime support.
 *
 * These hooks wrap the base realtime hook with specific table configurations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import { useSupabaseRealtime } from './realtime'
import {
    fetchTranscripts,
    fetchTranscriptById,
    fetchTranscriptJobs,
    fetchSpeakers,
    deleteTranscript as deleteTranscriptQuery,
    fetchProjects,
    createProject as createProjectQuery,
    renameProject as renameProjectQuery,
    moveTranscriptToProject,
    addTranscriptsToProject,
    updateTranscript as updateTranscriptQuery,
    createSpeaker as createSpeakerQuery,
    updateSpeaker as updateSpeakerQuery,
    deleteSpeaker as deleteSpeakerQuery,
} from './queries'
import { buildProjectTree } from '@/core/projects/tree'
import { randomId } from '@/lib/ids'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type {
    Transcript,
    Project,
    JobSummary,
    Speaker,
    SpeakerUpdate,
    TranscriptUpdate,
} from '@/contracts/db'
import type { AddTranscriptsResult, CreateProjectInput } from './queries'

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
        let authGeneration = 0
        const supabase = createClient()

        const loadUserId = async () => {
            const loadGeneration = authGeneration
            try {
                const { data: sessionData } = await supabase.auth.getSession()
                if (!isMounted || authGeneration !== loadGeneration) return
                const sessionUserId = sessionData.session?.user.id ?? null
                if (!sessionUserId) {
                    setIdentity({ userId: null, ready: true })
                    return
                }

                setIdentity({ userId: sessionUserId, ready: false })

                const { data, error } = await supabase.auth.getUser()
                if (!isMounted || authGeneration !== loadGeneration) return
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
            authGeneration += 1
            setIdentity({ userId: session?.user.id ?? null, ready: true })
        })

        return () => {
            isMounted = false
            authListener.subscription.unsubscribe()
        }
    }, [])

    return identity
}

/** Re-insert a transcript in created_at-desc order unless it is already present. */
function restoreTranscript(transcripts: Transcript[], transcript: Transcript): Transcript[] {
    if (transcripts.some((t) => t.id === transcript.id)) return transcripts

    const createdAt = Date.parse(transcript.created_at)
    const index = transcripts.findIndex((t) => Date.parse(t.created_at) < createdAt)
    return index === -1
        ? [...transcripts, transcript]
        : [...transcripts.slice(0, index), transcript, ...transcripts.slice(index)]
}

/**
 * Hook for fetching and subscribing to the transcripts list.
 * Uses Supabase Realtime with 5s polling fallback.
 */
export type RealtimeHookOptions = {
    enabled?: boolean
    userId: string | null
}

type DeleteInvalidationPayload = {
    payload?: { table?: unknown }
}

type DeleteInvalidationTable = 'projects' | 'transcripts'

type RefetchQueue = {
    running: boolean
    queued: boolean
}

/**
 * Reconciles DELETEs that user_id-filtered Postgres Changes subscriptions
 * cannot receive safely. The database sends no row data, only the affected
 * table name, on a private per-user topic.
 */
export function useProjectsDeleteInvalidation(
    userId: string,
    refetchProjects: () => Promise<void>,
    refetchTranscripts: () => Promise<void>
) {
    useEffect(() => {
        let active = true
        let channel: RealtimeChannel | null = null
        const supabase = createClient()
        const refetchQueues: Record<DeleteInvalidationTable, RefetchQueue> = {
            projects: { running: false, queued: false },
            transcripts: { running: false, queued: false },
        }
        const refetches = {
            projects: refetchProjects,
            transcripts: refetchTranscripts,
        }

        const queueRefetch = (table: DeleteInvalidationTable) => {
            const queue = refetchQueues[table]
            if (queue.running) {
                queue.queued = true
                return
            }

            queue.running = true
            void (async () => {
                while (active) {
                    queue.queued = false
                    try {
                        await refetches[table]()
                    } catch (error) {
                        console.error(`[projects] Failed to refetch ${table} after delete:`, error)
                    }
                    if (!queue.queued) break
                }
                queue.running = false
            })()
        }

        void supabase.realtime.setAuth().then(() => {
            if (!active) return
            channel = supabase
                .channel(`projects-v1:${userId}`, { config: { private: true } })
                .on('broadcast', { event: 'DELETE' }, (message: DeleteInvalidationPayload) => {
                    if (message.payload?.table === 'projects') {
                        queueRefetch('projects')
                    } else if (message.payload?.table === 'transcripts') {
                        queueRefetch('transcripts')
                    }
                })
                .subscribe((status) => {
                    if (!active || status !== 'SUBSCRIBED') return
                    queueRefetch('projects')
                    queueRefetch('transcripts')
                })
        }).catch((error) => {
            if (active) {
                console.error('[projects] Failed to authenticate delete invalidation channel:', error)
            }
        })

        return () => {
            active = false
            if (channel) void supabase.removeChannel(channel)
        }
    }, [refetchProjects, refetchTranscripts, userId])
}

export function useTranscriptsRealtime(options: RealtimeHookOptions) {
    const { enabled = true, userId } = options
    const fetchFn = useCallback(() => fetchTranscripts(), [])

    const { data, isLoading, error, connectionStatus, mutate, refetch } =
        useSupabaseRealtime<Transcript>('transcripts', fetchFn, {
            enabled,
            realtimeFilter: userId ? `user_id=eq.${userId}` : null,
            subscriptionEnabled: Boolean(userId),
            enablePollingFallback: true,
            pollingInterval: 5000,
            insertPosition: 'prepend',
        })

    // Action: Delete transcript with optimistic update
    const deleteTranscript = useCallback(
        async (id: string) => {
            // Snapshot synchronously: a state updater may run after the request settles.
            const removed = data.find((t) => t.id === id)
            mutate((current) => current.filter((t) => t.id !== id))

            try {
                return await deleteTranscriptQuery(id)
            } catch (err) {
                // Restore only the removed row so concurrent realtime changes survive.
                if (removed) mutate((current) => restoreTranscript(current, removed))
                // A delete can commit and still lose its response; reconcile with the server.
                void refetch()
                throw err
            }
        },
        [data, mutate, refetch]
    )

    const moveTranscript = useCallback(
        async (id: string, projectId: string | null) => {
            const previous = data.find((transcript) => transcript.id === id)
            mutate((current) =>
                current.map((transcript) =>
                    transcript.id === id ? { ...transcript, project_id: projectId } : transcript
                )
            )

            try {
                await moveTranscriptToProject(id, projectId)
            } catch (err) {
                if (previous) {
                    mutate((current) =>
                        current.map((transcript) =>
                            transcript.id === id && transcript.project_id === projectId
                                ? { ...transcript, project_id: previous.project_id }
                                : transcript
                        )
                    )
                }
                void refetch()
                throw err
            }
        },
        [data, mutate, refetch]
    )

    const addTranscripts = useCallback(
        async (ids: string[], projectId: string): Promise<AddTranscriptsResult> => {
            const idSet = new Set(ids)
            if (idSet.size === 0) return { addedIds: [], missingIds: [] }
            const previousProjects = new Map(
                data
                    .filter((transcript) => idSet.has(transcript.id))
                    .map((transcript) => [transcript.id, transcript.project_id])
            )

            mutate((current) =>
                current.map((transcript) =>
                    idSet.has(transcript.id)
                        ? { ...transcript, project_id: projectId }
                        : transcript
                )
            )

            let result: AddTranscriptsResult
            try {
                result = await addTranscriptsToProject(ids, projectId)
            } catch (err) {
                mutate((current) =>
                    current.map((transcript) => {
                        const previousProjectId = previousProjects.get(transcript.id)
                        return previousProjects.has(transcript.id) &&
                            transcript.project_id === projectId
                            ? { ...transcript, project_id: previousProjectId ?? null }
                            : transcript
                    })
                )
                void refetch()
                throw err
            }

            if (result.missingIds.length > 0) {
                // Deleted since they were selected; the DELETE event may not reach this tab.
                const missingIds = new Set(result.missingIds)
                mutate((current) => current.filter((transcript) => !missingIds.has(transcript.id)))
                void refetch()
            }
            return result
        },
        [data, mutate, refetch]
    )

    return {
        transcripts: data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        refetch,
        deleteTranscript,
        moveTranscript,
        addTranscripts,
    }
}

// ============================================================================
// Projects Hook
// ============================================================================

export function useProjectsRealtime(options: RealtimeHookOptions) {
    const { enabled = true, userId } = options
    const renameVersionsRef = useRef(new Map<string, number>())
    const fetchFn = useCallback(() => fetchProjects(), [])
    const { data, isLoading, error, connectionStatus, mutate, refetch } =
        useSupabaseRealtime<Project>('projects', fetchFn, {
            enabled,
            realtimeFilter: userId ? `user_id=eq.${userId}` : null,
            subscriptionEnabled: Boolean(userId),
            enablePollingFallback: true,
            pollingInterval: 5000,
        })
    const tree = useMemo(() => buildProjectTree(data), [data])

    const createProject = useCallback(
        async (input: CreateProjectInput) => {
            if (!userId) throw new Error('You must be signed in to create a project.')

            const now = new Date().toISOString()
            const optimisticId = randomId()
            const optimisticProject: Project = {
                id: optimisticId,
                user_id: userId,
                parent_id: input.parent_id,
                name: input.name.trim(),
                deleting_at: null,
                created_at: now,
                updated_at: now,
            }
            mutate((current) => [...current, optimisticProject])

            try {
                const created = await createProjectQuery({
                    ...input,
                    name: optimisticProject.name,
                })
                mutate((current) => [
                    ...current.filter(
                        (project) => project.id !== optimisticId && project.id !== created.id
                    ),
                    created,
                ])
                return created
            } catch (err) {
                mutate((current) => current.filter((project) => project.id !== optimisticId))
                void refetch()
                throw err
            }
        },
        [mutate, refetch, userId]
    )

    const renameProject = useCallback(
        async (id: string, name: string) => {
            const previous = data.find((project) => project.id === id)
            const nextName = name.trim()
            const requestVersion = (renameVersionsRef.current.get(id) ?? 0) + 1
            renameVersionsRef.current.set(id, requestVersion)
            mutate((current) =>
                current.map((project) =>
                    project.id === id ? { ...project, name: nextName } : project
                )
            )

            try {
                const renamed = await renameProjectQuery(id, nextName)
                if (renameVersionsRef.current.get(id) === requestVersion) {
                    mutate((current) =>
                        current.map((project) => (project.id === id ? renamed : project))
                    )
                }
                return renamed
            } catch (err) {
                if (renameVersionsRef.current.get(id) === requestVersion) {
                    if (previous) {
                        mutate((current) =>
                            current.map((project) =>
                                project.id === id && project.name === nextName
                                    ? { ...project, name: previous.name }
                                    : project
                            )
                        )
                    }
                    void refetch()
                }
                throw err
            }
        },
        [data, mutate, refetch]
    )

    return {
        projects: data,
        tree,
        isLoading,
        error,
        connectionStatus,
        createProject,
        renameProject,
        mutate,
        refetch,
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
