/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on projects, chunks, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
    Project,
    JobSummary,
    Chunk,
    Speaker,
    ChunkUpdate,
    SpeakerUpdate,
    SpeakerInsert,
    ProjectUpdate,
    Segment,
} from './types'

// ============================================================================
// Projects
// ============================================================================

/**
 * Fetch all projects for the current user.
 */
export async function fetchProjects(): Promise<Project[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

/**
 * Fetch a single project by ID.
 */
export async function fetchProjectById(id: string): Promise<Project | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
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
const JOB_SUMMARY_COLUMNS = 'id, project_id, inngest_event_id, idempotency_key, type, status, created_at, started_at, finished_at, updated_at'

/**
 * Fetch jobs for a project.
 * Returns JobSummary (excludes payload) to avoid sending large JSON to clients.
 */
export async function fetchProjectJobs(projectId: string): Promise<JobSummary[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('jobs')
        .select(JOB_SUMMARY_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

/**
 * Fetch error info for a job.
 * Only fetches payload for jobs in error state to get error details.
 * This is separate from fetchProjectJobs to avoid sending large Deepgram payloads.
 */
export async function fetchJobError(projectId: string): Promise<{
    error: string
    error_type: string
} | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('jobs')
        .select('payload')
        .eq('project_id', projectId)
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
 * Fetch watchlist terms for a project.
 */
export async function fetchWatchlistTerms(projectId: string): Promise<string[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('watchlist')
        .select('term')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

    if (error) throw error
    return (data || []).map((row) => row.term)
}

/**
 * Update a project.
 */
export async function updateProject(
    id: string,
    updates: ProjectUpdate
): Promise<Project> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Delete a project.
 */
export async function deleteProject(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('projects').delete().eq('id', id)

    if (error) throw error
}

// ============================================================================
// Chunks
// ============================================================================

const FETCH_ALL_ROWS_SUPPORTED_TABLES = new Set(['chunks', 'segments'])

/**
 * Fetch all rows from a table with pagination to avoid PostgREST's
 * default 1000-row limit which silently truncates large result sets.
 */
export async function paginateAllRows<T>(
    supabase: SupabaseClient,
    table: string,
    projectId: string,
    orderColumn: string = 'start_ms'
): Promise<T[]> {
    const PAGE_SIZE = 1000
    const allRows: T[] = []
    let offset = 0

    while (true) {
        const { data: page, error } = await supabase
            .from(table)
            .select('*')
            .eq('project_id', projectId)
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
 * - Default `orderColumn` is `start_ms`, used by `chunks` and `segments`.
 * - This helper only supports `chunks`/`segments`; use `paginateAllRows`
 *   directly for other tables with an explicit order column.
 */
async function fetchAllRows<T>(
    table: string,
    projectId: string,
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
            `[fetchAllRows] Unsupported table "${table}" for orderColumn "${normalizedOrderColumn}". Supported tables: chunks, segments.`
        )
    }

    const supabase = createClient()
    return paginateAllRows<T>(supabase, table, projectId, normalizedOrderColumn)
}

/**
 * Fetch all chunks for a project.
 */
export async function fetchChunks(projectId: string): Promise<Chunk[]> {
    return fetchAllRows<Chunk>('chunks', projectId)
}

/**
 * Fetch all segments for a project (fallback when chunks unavailable).
 */
export async function fetchSegments(projectId: string): Promise<Segment[]> {
    return fetchAllRows<Segment>('segments', projectId)
}

/**
 * Fetch transcript data for editor display.
 * Prefers chunks if available, falls back to segments.
 * Returns normalized data structure compatible with editor.
 */
export async function fetchTranscriptData(projectId: string): Promise<{
    items: Chunk[] | Segment[]
    source: 'chunks' | 'segments'
}> {
    // Try chunks first
    const chunks = await fetchChunks(projectId)
    if (chunks.length > 0) {
        return { items: chunks, source: 'chunks' }
    }

    // Fall back to segments
    const segments = await fetchSegments(projectId)
    return { items: segments, source: 'segments' }
}

/**
 * Update a chunk (text, speaker, etc).
 */
export async function updateChunk(
    id: string,
    updates: ChunkUpdate
): Promise<Chunk> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('chunks')
        .update({ ...updates, is_edited: true })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Update a segment (speaker only usually).
 */
export async function updateSegment(
    id: string,
    updates: { speaker_id?: string | null }
): Promise<Segment> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('segments')
        .update(updates)
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
 * Fetch all speakers for a project.
 */
export async function fetchSpeakers(projectId: string): Promise<Speaker[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('speakers')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Create a new speaker.
 */
export async function createSpeaker(
    projectId: string,
    label: string
): Promise<Speaker> {
    const supabase = createClient()
    const insert: SpeakerInsert = {
        project_id: projectId,
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
