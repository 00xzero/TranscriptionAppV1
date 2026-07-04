/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on transcripts, transcript rows, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from '@/infra/supabase/client'
import { WAVEFORM_BUCKET } from '@/lib/audio/compute-peaks'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
    Transcript,
    JobSummary,
    Speaker,
    SegmentUpdate,
    SpeakerUpdate,
    SpeakerInsert,
    TranscriptUpdate,
    Segment,
} from '@/contracts/db'

// ============================================================================
// Transcripts
// ============================================================================

/**
 * Fetch all transcripts for the current user.
 */
export async function fetchTranscripts(): Promise<Transcript[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('transcripts')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
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

function isMissingStorageObjectError(error: { message?: string; error?: string; code?: string }) {
    const message = error.message?.toLowerCase() ?? ''
    const errorName = error.error?.toLowerCase() ?? ''
    const code = error.code?.toLowerCase() ?? ''

    return (
        code === 'nosuchkey' ||
        errorName === 'nosuchkey' ||
        errorName === 'no such key' ||
        message.includes('no such key') ||
        message.includes('nosuchkey') ||
        message.includes('object not found') ||
        message.includes('specified key does not exist')
    )
}

async function removeStorageObjectIfPresent(
    supabase: SupabaseClient,
    bucket: string,
    objectKey: string | null
): Promise<void> {
    if (!objectKey) return

    const { error } = await supabase.storage.from(bucket).remove([objectKey])
    if (error && !isMissingStorageObjectError(error)) throw error

    if (error) {
        console.warn(`[deleteTranscript] Storage object already missing in ${bucket}: ${objectKey}`, error.message)
    }
}

/**
 * Delete a transcript.
 */
export async function deleteTranscript(id: string): Promise<void> {
    const supabase = createClient()
    const { data: transcript, error: fetchError } = await supabase
        .from('transcripts')
        .select('source_object_key, waveform_object_key')
        .eq('id', id)
        .maybeSingle()

    if (fetchError) throw fetchError
    if (!transcript) return

    await removeStorageObjectIfPresent(supabase, 'media', transcript.source_object_key)
    await removeStorageObjectIfPresent(supabase, WAVEFORM_BUCKET, transcript.waveform_object_key)

    const { error } = await supabase.from('transcripts').delete().eq('id', id)

    if (error) throw error
}

// ============================================================================
// Transcript Rows
// ============================================================================

const FETCH_ALL_ROWS_SUPPORTED_TABLES = new Set(['segments'])

/**
 * Fetch all rows from a table with pagination to avoid PostgREST's
 * default 1000-row limit which silently truncates large result sets.
 */
export async function paginateAllRows<T>(
    supabase: SupabaseClient,
    table: string,
    transcriptId: string,
    orderColumn: string = 'start_ms'
): Promise<T[]> {
    const PAGE_SIZE = 1000
    const allRows: T[] = []
    let offset = 0

    while (true) {
        const { data: page, error } = await supabase
            .from(table)
            .select('*')
            .eq('transcript_id', transcriptId)
            .order(orderColumn, { ascending: true })
            .order('id', { ascending: true }) // tie-breaker for deterministic pagination
            .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw error
        if (!page || page.length === 0) break
        allRows.push(...(page as T[]))
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
    }

    return allRows
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
async function fetchAllRows<T>(
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
