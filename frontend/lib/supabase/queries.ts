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
    ProjectSpeakerSummary,
    Speaker,
    SegmentUpdate,
    SegmentSpeakerChange,
    SegmentSpeakerAssignment,
    NewSpeakerSegmentChange,
    TranscriptSummary,
    TranscriptUpdate,
    Segment,
} from '@/contracts/db'
import {
    NewSpeakerSegmentChangeSchema,
    ProjectSpeakerSummariesResultSchema,
    ReassignSegmentsResultSchema,
    SegmentSpeakerChangeSchema,
    SpeakerSchema,
    TranscriptSummarySchema,
} from '@/contracts/db'
import { z } from 'zod'

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

// A literal so Supabase can type the projection; tests pin it to the schema's keys.
const TRANSCRIPT_SUMMARY_COLUMNS =
    'id, project_id, title, status, duration_seconds, created_at, updated_at'
const TranscriptSummariesSchema = z.array(TranscriptSummarySchema)

/**
 * Fetch the compact transcript index for the current user.
 */
export async function fetchTranscriptSummaries(): Promise<TranscriptSummary[]> {
    const supabase = createClient()
    const rows = await paginateRows<{ id: string }>((from, to) =>
        supabase
            .from('transcripts')
            .select(TRANSCRIPT_SUMMARY_COLUMNS)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to)
    )
    return TranscriptSummariesSchema.parse(rows)
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
 * Speaker avatar summaries for a set of projects, in one request.
 *
 * Deliberately uncapped: the Library asks for at most RECENT_PROJECT_LIMIT ids
 * and the project header for one, so a cap would guard nothing — and silently
 * truncating the input would return incomplete results that look complete.
 *
 * Returns a Map because absent is not the same as zero: a missing key means the
 * project is not the caller's, is being deleted, or is gone, while a present
 * entry with speaker_count 0 means it simply has no speakers yet.
 */
export async function fetchProjectSpeakerSummaries(
    projectIds: string[],
    options: { includeDescendants: boolean; previewLimit?: number }
): Promise<Map<string, ProjectSpeakerSummary>> {
    if (projectIds.length === 0) return new Map()

    const supabase = createClient()
    const { data, error } = await supabase.rpc('project_speaker_summaries', {
        p_project_ids: projectIds,
        p_include_descendants: options.includeDescendants,
        p_preview_limit: options.previewLimit ?? 4,
    })

    if (error) throw error

    const parsed = ProjectSpeakerSummariesResultSchema.safeParse(data ?? [])
    if (!parsed.success) {
        throw new Error('Malformed project_speaker_summaries response')
    }
    return new Map(parsed.data.map((row) => [row.project_id, row]))
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
 * Fetch error info for a job.
 * Only fetches payload for jobs in error state to get error details.
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
 * Fetch each segment's speaker assignment only: the columns a speaker refresh
 * needs, without re-downloading every segment's text.
 */
export async function fetchSegmentSpeakerAssignments(
    transcriptId: string
): Promise<Pick<Segment, 'id' | 'speaker_id'>[]> {
    const supabase = createClient()
    return paginateRows<Pick<Segment, 'id' | 'speaker_id'>>((from, to) =>
        supabase
            .from('segments')
            .select('id, speaker_id')
            .eq('transcript_id', transcriptId)
            .order('start_ms', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
    )
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
 * Update a segment's text. Its speaker changes only through reassignSegments.
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
        // save_transcript_segments inserts every speaker of a transcript in one
        // transaction, so they all share the transaction's now() and created_at is
        // a total tie. id is the only deterministic key, and without it a rename
        // (which rewrites the tuple) can silently reshuffle palette colors.
        // project_speaker_summaries orders on the same two columns.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Set or clear a speaker's transcript-local label (null clears it back to
 * `Speaker {ordinal}`). `expectedCustomLabel` is the value last read; the
 * database refuses the write if it has changed since.
 */
export async function setSpeakerCustomLabel(
    speakerId: string,
    expectedCustomLabel: string | null,
    customLabel: string | null
): Promise<Speaker> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('set_speaker_custom_label', {
        p_speaker_id: speakerId,
        p_expected_custom_label: expectedCustomLabel,
        p_custom_label: customLabel,
    })

    if (error) throw error
    return SpeakerSchema.parse(data)
}

/**
 * Reassign segments of one transcript, all or nothing. Each change names the
 * speaker the segment is expected to hold and its new speaker (null = Unknown).
 */
export async function reassignSegments(
    transcriptId: string,
    changes: SegmentSpeakerChange[]
): Promise<SegmentSpeakerAssignment[]> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('reassign_segments', {
        p_transcript_id: transcriptId,
        p_changes: z.array(SegmentSpeakerChangeSchema).parse(changes),
    })

    if (error) throw error
    return ReassignSegmentsResultSchema.parse(data ?? [])
}

/**
 * Create a transcript speaker with a local label and move the given segments
 * to it, as one operation. Returns the new speaker.
 */
export async function assignSegmentsToNewSpeaker(
    transcriptId: string,
    customLabel: string,
    changes: NewSpeakerSegmentChange[]
): Promise<Speaker> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('assign_segments_to_new_speaker', {
        p_transcript_id: transcriptId,
        p_custom_label: customLabel,
        p_changes: z.array(NewSpeakerSegmentChangeSchema).parse(changes),
    })

    if (error) throw error
    return SpeakerSchema.parse(data)
}
