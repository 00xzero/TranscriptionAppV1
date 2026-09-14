/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on transcripts, transcript rows, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from '@/infra/supabase/client'
import {
    MEDIA_BUCKET,
    removeStorageObjectIfPresent,
    WAVEFORM_BUCKET,
} from '@/infra/supabase/storage'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
    Transcript,
    Project,
    JobSummary,
    Speaker,
    SegmentUpdate,
    SpeakerUpdate,
    SpeakerInsert,
    TranscriptUpdate,
    Segment,
} from '@/contracts/db'

const PAGE_SIZE = 1000

type PageResult<T> = {
    data: T[] | null
    error: unknown
}

async function paginateRows<T extends { id: string }>(
    fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
    const rowsById = new Map<string, T>()
    let offset = 0

    while (true) {
        const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
        if (error) throw error
        if (!data || data.length === 0) break

        for (const row of data) {
            if (!rowsById.has(row.id)) rowsById.set(row.id, row)
        }
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
    }

    return [...rowsById.values()]
}

// ============================================================================
// Transcripts
// ============================================================================

/**
 * Fetch all transcripts for the current user.
 */
export async function fetchTranscripts(): Promise<Transcript[]> {
    const supabase = createClient()
    return paginateRows<Transcript>((from, to) =>
        supabase
            .from('transcripts')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
    )
}

// ============================================================================
// Projects
// ============================================================================

export type CreateProjectInput = {
    name: string
    parent_id: string | null
}

export async function fetchProjects(): Promise<Project[]> {
    const supabase = createClient()
    return paginateRows<Project>((from, to) =>
        supabase
            .from('projects')
            .select('*')
            .order('name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
    )
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
    const supabase = createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!authData.user) throw new Error('You must be signed in to create a project.')

    const { data, error } = await supabase
        .from('projects')
        .insert({ ...input, user_id: authData.user.id })
        .select()
        .single()

    if (error) throw error
    return data
}

export async function renameProject(id: string, name: string): Promise<Project> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .update({ name })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

export async function moveTranscriptToProject(
    transcriptId: string,
    projectId: string | null
): Promise<string> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('transcripts')
        .update({ project_id: projectId })
        .eq('id', transcriptId)
        .select('id')
        .single()

    if (error) throw error
    if (!data || data.id !== transcriptId) {
        throw new Error('The transcript could not be moved because it is no longer available.')
    }
    return data.id
}

export type AddTranscriptsResult = {
    addedIds: string[]
    missingIds: string[]
}

/**
 * Adds transcripts to a project in one update. Database errors (a missing or
 * marked project) reject the whole statement, so ids absent from the result are
 * rows RLS cannot see: in practice, transcripts deleted after they were selected.
 * The visible rows have already committed, so missing ids are reported, not thrown.
 */
export async function addTranscriptsToProject(
    ids: string[],
    projectId: string
): Promise<AddTranscriptsResult> {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return { addedIds: [], missingIds: [] }

    const supabase = createClient()
    const { data, error } = await supabase
        .from('transcripts')
        .update({ project_id: projectId })
        .in('id', uniqueIds)
        .select('id')

    if (error) throw error
    const updatedIds = new Set((data ?? []).map((row) => row.id))
    return {
        addedIds: uniqueIds.filter((id) => updatedIds.has(id)),
        missingIds: uniqueIds.filter((id) => !updatedIds.has(id)),
    }
}

export async function fetchProjectBranchTranscriptCount(id: string): Promise<number> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('project_branch_transcript_count', { p_id: id })

    if (error) throw error
    return data ?? 0
}

/**
 * Fetch a single transcript by ID.
 */
export async function fetchTranscriptById(id: string): Promise<Transcript | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('transcripts')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        if (error.code === 'PGRST116') return null // Not found
        throw error
    }
    return data
}

/**
 * Columns to select for job summaries (excludes large `payload` field).
 * The payload can be multi-MB for long transcriptions and should only be
 * accessed by backend/Inngest processing, not sent to browsers.
 */
const JOB_SUMMARY_COLUMNS = 'id, transcript_id, inngest_event_id, idempotency_key, type, status, created_at, started_at, finished_at, updated_at'

/**
 * Fetch jobs for a transcript.
 * Returns JobSummary (excludes payload) to avoid sending large JSON to clients.
 */
export async function fetchTranscriptJobs(transcriptId: string): Promise<JobSummary[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('jobs')
        .select(JOB_SUMMARY_COLUMNS)
        .eq('transcript_id', transcriptId)
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

/**
 * Fetch error info for a job.
 * Only fetches payload for jobs in error state to get error details.
 * This is separate from fetchTranscriptJobs to avoid sending large Deepgram payloads.
 */
export async function fetchJobError(transcriptId: string): Promise<{
    error: string
    error_type: string
} | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('jobs')
        .select('payload')
        .eq('transcript_id', transcriptId)
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (error || !data) return null

    const payload = data.payload as { error?: string; error_type?: string } | null
    if (!payload?.error) return null

    return {
        error: payload.error,
        error_type: payload.error_type || 'transcription_error',
    }
}

/**
 * Fetch watchlist terms for a transcript.
 */
export async function fetchWatchlistTerms(transcriptId: string): Promise<string[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('watchlist')
        .select('term')
        .eq('transcript_id', transcriptId)
        .order('created_at', { ascending: true })

    if (error) throw error
    return (data || []).map((row) => row.term)
}

/**
 * Update a transcript.
 */
export async function updateTranscript(
    id: string,
    updates: TranscriptUpdate
): Promise<Transcript> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('transcripts')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

export type DeleteTranscriptResult = {
    /** Keys linked during the delete whose objects could not be removed. */
    cleanupPendingKeys: string[]
}

/**
 * Delete a transcript and its storage objects.
 *
 * Throws while the row still exists. Once the row is gone it resolves, reporting
 * any late-linked objects it could not remove.
 */
export async function deleteTranscript(id: string): Promise<DeleteTranscriptResult> {
    const supabase = createClient()
    const { data: transcript, error: fetchError } = await supabase
        .from('transcripts')
        .select('user_id, source_object_key, waveform_object_key')
        .eq('id', id)
        .maybeSingle()

    if (fetchError) throw fetchError
    if (!transcript) return { cleanupPendingKeys: [] }

    await Promise.all([
        removeStorageObjectIfPresent(
            supabase,
            MEDIA_BUCKET,
            transcript.source_object_key,
            transcript.user_id
        ),
        removeStorageObjectIfPresent(
            supabase,
            WAVEFORM_BUCKET,
            transcript.waveform_object_key,
            transcript.user_id
        ),
    ])

    const { data: deletedTranscript, error } = await supabase
        .from('transcripts')
        .delete()
        .eq('id', id)
        .select('source_object_key, waveform_object_key')
        .maybeSingle()

    if (error) throw error
    // Another tab already deleted it.
    if (!deletedTranscript) return { cleanupPendingKeys: [] }

    // Sweep keys linked between the initial read and the row delete.
    const cleanupPendingKeys: string[] = []
    for (const [bucket, before, after] of [
        [MEDIA_BUCKET, transcript.source_object_key, deletedTranscript.source_object_key],
        [WAVEFORM_BUCKET, transcript.waveform_object_key, deletedTranscript.waveform_object_key],
    ] as const) {
        if (!after || after === before) continue
        try {
            await removeStorageObjectIfPresent(supabase, bucket, after, transcript.user_id)
        } catch {
            cleanupPendingKeys.push(after)
        }
    }

    return { cleanupPendingKeys }
}

// ============================================================================
// Transcript Rows
// ============================================================================

const FETCH_ALL_ROWS_SUPPORTED_TABLES = new Set(['segments'])

/**
 * Fetch all rows from a table with pagination to avoid PostgREST's
 * default 1000-row limit which silently truncates large result sets.
 */
export async function paginateAllRows<T extends { id: string }>(
    supabase: SupabaseClient,
    table: string,
    transcriptId: string,
    orderColumn: string = 'start_ms'
): Promise<T[]> {
    return paginateRows<T>((from, to) =>
        supabase
            .from(table)
            .select('*')
            .eq('transcript_id', transcriptId)
            .order(orderColumn, { ascending: true })
            .order('id', { ascending: true }) // tie-breaker for deterministic pagination
            .range(from, to) as unknown as PromiseLike<PageResult<T>>
    )
}

/**
 * Fetch all rows from a table with pagination to avoid PostgREST's
 * default 1000-row limit which silently truncates large result sets.
 *
 * Contract:
 * - `orderColumn` must exist on the target table.
 * - Default `orderColumn` is `start_ms`, used by transcript segments.
 * - This helper only supports `segments`; use `paginateAllRows`
 *   directly for other tables with an explicit order column.
 */
async function fetchAllRows<T extends { id: string }>(
    table: string,
    transcriptId: string,
    orderColumn: string = 'start_ms'
): Promise<T[]> {
    const normalizedOrderColumn = orderColumn.trim()

    if (!normalizedOrderColumn) {
        throw new Error(
            `[fetchAllRows] Invalid orderColumn for table "${table}": "${orderColumn}". orderColumn must be a non-empty column name.`
        )
    }

    if (!FETCH_ALL_ROWS_SUPPORTED_TABLES.has(table)) {
        throw new Error(
            `[fetchAllRows] Unsupported table "${table}" for orderColumn "${normalizedOrderColumn}". Supported tables: segments.`
        )
    }

    const supabase = createClient()
    return paginateAllRows<T>(supabase, table, transcriptId, normalizedOrderColumn)
}

/**
 * Fetch all segments for a transcript.
 */
export async function fetchSegments(transcriptId: string): Promise<Segment[]> {
    return fetchAllRows<Segment>('segments', transcriptId)
}

/**
 * Fetch transcript data for editor display.
 * Returns normalized data structure compatible with editor.
 */
export async function fetchTranscriptData(transcriptId: string): Promise<{
    items: Segment[]
}> {
    const segments = await fetchSegments(transcriptId)
    return { items: segments }
}

/**
 * Update a segment (text, speaker, etc).
 */
export async function updateSegment(
    id: string,
    updates: SegmentUpdate
): Promise<Segment> {
    const payload = updates.text !== undefined
        ? { ...updates, is_edited: true }
        : updates

    const supabase = createClient()
    const { data, error } = await supabase
        .from('segments')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

// ============================================================================
// Speakers
// ============================================================================

/**
 * Fetch all speakers for a transcript.
 */
export async function fetchSpeakers(transcriptId: string): Promise<Speaker[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('speakers')
        .select('*')
        .eq('transcript_id', transcriptId)
        .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Create a new speaker.
 */
export async function createSpeaker(
    transcriptId: string,
    label: string
): Promise<Speaker> {
    const supabase = createClient()
    const insert: SpeakerInsert = {
        transcript_id: transcriptId,
        label,
    }

    const { data, error } = await supabase
        .from('speakers')
        .insert(insert)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Update a speaker.
 */
export async function updateSpeaker(
    id: string,
    updates: SpeakerUpdate
): Promise<Speaker> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('speakers')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Delete a speaker.
 */
export async function deleteSpeaker(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('speakers').delete().eq('id', id)

    if (error) throw error
}
