/**
 * Is this job still the one to act for?
 *
 * Background steps re-ask this right before a consequential action instead of
 * trusting an earlier step's cached answer: the job may have timed out or been
 * replaced in between.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type JobIds = { transcriptId: string; jobId: string }

async function readJobStatus(admin: SupabaseClient, { transcriptId, jobId }: JobIds): Promise<string | null> {
    const { data, error } = await admin
        .from('jobs')
        .select('status, transcript_id')
        .eq('id', jobId)
        .maybeSingle()
    if (error) throw new Error(`Failed to read job ${jobId}: ${error.message}`)
    if (!data || data.transcript_id !== transcriptId) return null
    return data.status as string
}

/** The job is this transcript's and still waiting: it may convert, swap and go to Deepgram. */
export async function jobQueued(admin: SupabaseClient, ids: JobIds): Promise<boolean> {
    return (await readJobStatus(admin, ids)) === 'queued'
}

/** The job is this transcript's and has not failed: Deepgram may already have moved it on. */
export async function jobLive(admin: SupabaseClient, ids: JobIds): Promise<boolean> {
    const status = await readJobStatus(admin, ids)
    return status === 'queued' || status === 'processing' || status === 'completed'
}
