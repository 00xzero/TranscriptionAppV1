/**
 * React hooks for Supabase data fetching with Realtime support.
 *
 * These hooks wrap the base realtime hook with specific table configurations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/infra/supabase/client'
import {
    isRealtimeScopeAbortError,
    runBackgroundRealtimeRefetch,
    useSupabaseRealtime,
} from './realtime'
import {
    fetchTranscripts,
    deleteTranscript as deleteTranscriptQuery,
    fetchProjects,
    createProject as createProjectQuery,
    renameProject as renameProjectQuery,
    moveTranscriptToProject,
    addTranscriptsToProject,
} from './queries'
import { buildProjectTree } from '@/core/projects/tree'
import { randomId } from '@/lib/ids'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type {
    Transcript,
    Project,
} from '@/contracts/db'
import type { AddTranscriptsResult, CreateProjectInput } from './queries'

// ============================================================================
// Transcripts Hook
// ============================================================================

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
    retryWait: {
        timeout: ReturnType<typeof setTimeout>
        resolve: () => void
    } | null
}

const DELETE_REFETCH_RETRY_DELAYS = [250, 500, 1000] as const
const privateChannelLifecycles = new Map<string, Promise<void>>()

function channelHasTopic(channel: RealtimeChannel, topic: string): boolean {
    return channel.topic === topic || channel.topic === `realtime:${topic}`
}

function enqueuePrivateChannelLifecycle(
    topic: string,
    operation: () => Promise<void>
): Promise<void> {
    const previous = privateChannelLifecycles.get(topic) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    privateChannelLifecycles.set(topic, current)
    void current.finally(() => {
        if (privateChannelLifecycles.get(topic) === current) {
            privateChannelLifecycles.delete(topic)
        }
    }).catch(() => undefined)
    return current
}

/**
 * Reconciles DELETEs that user_id-filtered Postgres Changes subscriptions
 * cannot receive safely. The database sends no row data, only the affected
 * table name, on a private per-user topic.
 */
export function useProjectsDeleteInvalidation(
    userId: string | null,
    refetchProjects: () => Promise<void>,
    refetchTranscripts: () => Promise<void>
) {
    useEffect(() => {
        if (!userId) return

        let active = true
        let channel: RealtimeChannel | null = null
        const supabase = createClient()
        const topic = `projects-v1:${userId}`
        const lifecycle = Symbol(topic)
        let currentLifecycle = lifecycle
        let loggedLifecycleFailure = false
        const refetchQueues: Record<DeleteInvalidationTable, RefetchQueue> = {
            projects: { running: false, queued: false, retryWait: null },
            transcripts: { running: false, queued: false, retryWait: null },
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
                    let cancelled = false

                    for (let attempt = 0; attempt <= DELETE_REFETCH_RETRY_DELAYS.length; attempt += 1) {
                        try {
                            await refetches[table]()
                            break
                        } catch (error) {
                            if (!active || isRealtimeScopeAbortError(error)) {
                                cancelled = true
                                break
                            }

                            const retryDelay = DELETE_REFETCH_RETRY_DELAYS[attempt]
                            if (retryDelay === undefined) {
                                console.error(
                                    `[projects] Failed to refetch ${table} after delete:`,
                                    error
                                )
                                break
                            }

                            await new Promise<void>((resolve) => {
                                const timeout = setTimeout(() => {
                                    queue.retryWait = null
                                    resolve()
                                }, retryDelay)
                                queue.retryWait = { timeout, resolve }
                            })
                            if (!active) {
                                cancelled = true
                                break
                            }
                        }
                    }
                    if (cancelled) break
                    if (!queue.queued) break
                }
                queue.running = false
            })()
        }

        const logLifecycleFailure = (message: string, error?: unknown) => {
            if (loggedLifecycleFailure) return
            loggedLifecycleFailure = true
            if (error === undefined) console.error(message)
            else console.error(message, error)
        }

        const setup = enqueuePrivateChannelLifecycle(topic, async () => {
            await supabase.realtime.setAuth()
            if (!active || currentLifecycle !== lifecycle) return

            const existing = supabase.getChannels().filter((candidate) =>
                channelHasTopic(candidate, topic)
            )
            if (existing.length > 0) {
                logLifecycleFailure(
                    `[projects] Could not replace the delete invalidation channel for ${topic}.`
                )
                return
            }

            const freshChannel = supabase.channel(topic, { config: { private: true } })
            const matching = supabase.getChannels().filter((candidate) =>
                channelHasTopic(candidate, topic)
            )
            if (
                !active
                || currentLifecycle !== lifecycle
                || matching.length !== 1
                || matching[0] !== freshChannel
            ) {
                if (matching.includes(freshChannel)) {
                    await supabase.removeChannel(freshChannel)
                }
                return
            }

            channel = freshChannel
                .on('broadcast', { event: 'DELETE' }, (message: DeleteInvalidationPayload) => {
                    if (!active || currentLifecycle !== lifecycle) return
                    if (message.payload?.table === 'projects') {
                        queueRefetch('projects')
                    } else if (message.payload?.table === 'transcripts') {
                        queueRefetch('transcripts')
                    }
                })
                .subscribe((status) => {
                    if (
                        !active
                        || currentLifecycle !== lifecycle
                        || status !== 'SUBSCRIBED'
                    ) return
                    queueRefetch('projects')
                    queueRefetch('transcripts')
                })
        })
        void setup.catch((error) => {
            if (active && currentLifecycle === lifecycle) {
                logLifecycleFailure(
                    '[projects] Failed to authenticate delete invalidation channel:',
                    error
                )
            }
        })

        return () => {
            active = false
            currentLifecycle = Symbol('cancelled-projects-invalidation')
            for (const queue of Object.values(refetchQueues)) {
                if (queue.retryWait) {
                    clearTimeout(queue.retryWait.timeout)
                    queue.retryWait.resolve()
                    queue.retryWait = null
                }
            }

            const cleanup = enqueuePrivateChannelLifecycle(topic, async () => {
                const ownedChannel = channel
                channel = null
                if (!ownedChannel) return

                const result = await supabase.removeChannel(ownedChannel)
                const remains = supabase.getChannels().some((candidate) =>
                    channelHasTopic(candidate, topic)
                )
                if (result === 'error' && remains) {
                    logLifecycleFailure(
                        `[projects] Failed to remove the delete invalidation channel for ${topic}.`
                    )
                } else if (remains) {
                    logLifecycleFailure(
                        `[projects] Delete invalidation channel ${topic} remained after removal.`
                    )
                }
            })
            void cleanup.catch((error) => {
                logLifecycleFailure(
                    `[projects] Failed to remove the delete invalidation channel for ${topic}:`,
                    error
                )
            })
        }
    }, [refetchProjects, refetchTranscripts, userId])
}

export function useTranscriptsRealtime(options: RealtimeHookOptions) {
    const { enabled = true, userId } = options
    const fetchFn = useCallback(() => fetchTranscripts(), [])

    const {
        data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        mutateOptimistically,
        refetch,
        assertCurrentScope,
    } =
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
            assertCurrentScope()
            if (!userId) throw new Error('You must be signed in to delete a transcript.')

            // Snapshot synchronously: a state updater may run after the request settles.
            const removed = data.find((t) => t.id === id)
            const settleOptimistic = mutateOptimistically(
                (current) => current.filter((t) => t.id !== id)
            )

            try {
                const result = await deleteTranscriptQuery(id)
                assertCurrentScope()
                runBackgroundRealtimeRefetch(refetch, 'transcript deletion')
                return result
            } catch (err) {
                assertCurrentScope()
                // Restore only the removed row so concurrent realtime changes survive.
                if (removed) mutate((current) => restoreTranscript(current, removed))
                // A delete can commit and still lose its response; reconcile with the server.
                runBackgroundRealtimeRefetch(refetch, 'transcript deletion failure')
                throw err
            } finally {
                settleOptimistic()
            }
        },
        [assertCurrentScope, data, mutate, mutateOptimistically, refetch, userId]
    )

    const moveTranscript = useCallback(
        async (id: string, projectId: string | null) => {
            assertCurrentScope()
            if (!userId) throw new Error('You must be signed in to move a transcript.')

            const previous = data.find((transcript) => transcript.id === id)
            const settleOptimistic = mutateOptimistically((current) =>
                current.map((transcript) =>
                    transcript.id === id ? { ...transcript, project_id: projectId } : transcript
                )
            )

            try {
                await moveTranscriptToProject(id, projectId)
                assertCurrentScope()
                runBackgroundRealtimeRefetch(refetch, 'transcript move')
            } catch (err) {
                assertCurrentScope()
                if (previous) {
                    mutate((current) =>
                        current.map((transcript) =>
                            transcript.id === id && transcript.project_id === projectId
                                ? { ...transcript, project_id: previous.project_id }
                                : transcript
                        )
                    )
                }
                runBackgroundRealtimeRefetch(refetch, 'transcript move failure')
                throw err
            } finally {
                settleOptimistic()
            }
        },
        [assertCurrentScope, data, mutate, mutateOptimistically, refetch, userId]
    )

    const addTranscripts = useCallback(
        async (ids: string[], projectId: string): Promise<AddTranscriptsResult> => {
            assertCurrentScope()
            if (!userId) throw new Error('You must be signed in to add transcripts.')

            const idSet = new Set(ids)
            if (idSet.size === 0) return { addedIds: [], missingIds: [] }
            const previousProjects = new Map(
                data
                    .filter((transcript) => idSet.has(transcript.id))
                    .map((transcript) => [transcript.id, transcript.project_id])
            )

            const settleOptimistic = mutateOptimistically((current) =>
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
                assertCurrentScope()
                mutate((current) =>
                    current.map((transcript) => {
                        const previousProjectId = previousProjects.get(transcript.id)
                        return previousProjects.has(transcript.id) &&
                            transcript.project_id === projectId
                            ? { ...transcript, project_id: previousProjectId ?? null }
                            : transcript
                    })
                )
                runBackgroundRealtimeRefetch(refetch, 'batch transcript move failure')
                throw err
            } finally {
                settleOptimistic()
            }

            assertCurrentScope()

            if (result.missingIds.length > 0) {
                // Deleted since they were selected; the DELETE event may not reach this tab.
                const missingIds = new Set(result.missingIds)
                mutate((current) => current.filter((transcript) => !missingIds.has(transcript.id)))
            }
            runBackgroundRealtimeRefetch(refetch, 'batch transcript move')
            return result
        },
        [assertCurrentScope, data, mutate, mutateOptimistically, refetch, userId]
    )

    return useMemo(() => ({
        transcripts: data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        refetch,
        deleteTranscript,
        moveTranscript,
        addTranscripts,
    }), [
        addTranscripts,
        connectionStatus,
        data,
        deleteTranscript,
        error,
        isLoading,
        moveTranscript,
        mutate,
        refetch,
    ])
}

// ============================================================================
// Projects Hook
// ============================================================================

export function useProjectsRealtime(options: RealtimeHookOptions) {
    const { enabled = true, userId } = options
    const renameVersionsRef = useRef(new Map<string, number>())
    const fetchFn = useCallback(() => fetchProjects(), [])
    const {
        data,
        isLoading,
        error,
        connectionStatus,
        mutate,
        mutateOptimistically,
        refetch,
        assertCurrentScope,
    } =
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
            assertCurrentScope()
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
            const settleOptimistic = mutateOptimistically(
                (current) => [...current, optimisticProject]
            )

            try {
                const created = await createProjectQuery({
                    ...input,
                    name: optimisticProject.name,
                })
                assertCurrentScope()
                mutate((current) => [
                    ...current.filter(
                        (project) => project.id !== optimisticId && project.id !== created.id
                    ),
                    created,
                ])
                return created
            } catch (err) {
                assertCurrentScope()
                mutate((current) => current.filter((project) => project.id !== optimisticId))
                runBackgroundRealtimeRefetch(refetch, 'project creation failure')
                throw err
            } finally {
                settleOptimistic()
            }
        },
        [assertCurrentScope, mutate, mutateOptimistically, refetch, userId]
    )

    const renameProject = useCallback(
        async (id: string, name: string) => {
            assertCurrentScope()
            if (!userId) throw new Error('You must be signed in to rename a project.')

            const previous = data.find((project) => project.id === id)
            const nextName = name.trim()
            const requestVersion = (renameVersionsRef.current.get(id) ?? 0) + 1
            renameVersionsRef.current.set(id, requestVersion)
            const settleOptimistic = mutateOptimistically((current) =>
                current.map((project) =>
                    project.id === id ? { ...project, name: nextName } : project
                )
            )

            try {
                const renamed = await renameProjectQuery(id, nextName)
                assertCurrentScope()
                if (renameVersionsRef.current.get(id) === requestVersion) {
                    mutate((current) =>
                        current.map((project) => (project.id === id ? renamed : project))
                    )
                }
                return renamed
            } catch (err) {
                assertCurrentScope()
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
                    runBackgroundRealtimeRefetch(refetch, 'project rename failure')
                }
                throw err
            } finally {
                settleOptimistic()
            }
        },
        [assertCurrentScope, data, mutate, mutateOptimistically, refetch, userId]
    )

    return useMemo(() => ({
        projects: data,
        tree,
        isLoading,
        error,
        connectionStatus,
        createProject,
        renameProject,
        mutate,
        refetch,
    }), [
        connectionStatus,
        createProject,
        data,
        error,
        isLoading,
        mutate,
        refetch,
        renameProject,
        tree,
    ])
}
