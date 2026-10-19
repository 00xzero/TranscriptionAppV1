/**
 * Is this job still the one to act for?
 *
 * Background steps re-ask this right before a consequential action instead of
 * trusting an earlier step's cached answer: the job may have timed out or been
 * replaced in between.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readPositiveIntEnv } from '@/lib/env'

/** The timeout reaper fails a job still queued or processing this long after it was created. */
export const TRANSCRIPTION_TIMEOUT_MS = readPositiveIntEnv('TRANSCRIPTION_TIMEOUT_MINUTES', 45) * 60_000

export type JobIds = { transcriptId: string; jobId: string }

type JobRow = { status: string; createdAt: string }

async function readJob(admin: SupabaseClient, { transcriptId, jobId }: JobIds): Promise<JobRow | null> {
    const { data, error } = await admin
        .from('jobs')
        .select('status, transcript_id, created_at')
        .eq('id', jobId)
        .maybeSingle()
    if (error) throw new Error(`Failed to read job ${jobId}: ${error.message}`)
    if (!data || data.transcript_id !== transcriptId) return null
    return { status: data.status as string, createdAt: data.created_at as string }
}

/** The job is this transcript's and still waiting: it may convert, swap and go to the engine. */
export async function jobQueued(admin: SupabaseClient, ids: JobIds): Promise<boolean> {
    return (await readJob(admin, ids))?.status === 'queued'
}

/**
 * How long, in ms, this transcript's job has been waiting since it was
 * created, or null once it is no longer queued. The timeout reaper measures
 * a queued job from the same moment.
 */
export async function queuedJobAgeMs(admin: SupabaseClient, ids: JobIds): Promise<number | null> {
    const job = await readJob(admin, ids)
    if (job?.status !== 'queued') return null
    const createdAt = Date.parse(job.createdAt)
    return Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : 0
}

/** The job is this transcript's and has not failed: the engine may already have moved it on. */
export async function jobLive(admin: SupabaseClient, ids: JobIds): Promise<boolean> {
    const status = (await readJob(admin, ids))?.status
    return status === 'queued' || status === 'processing' || status === 'completed'
}
