/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on projects, transcript rows, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from '@/infra/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
    Project,
    JobSummary,
    Speaker,
    SegmentUpdate,
    SpeakerUpdate,
    SpeakerInsert,
    ProjectUpdate,
    Segment,
} from '@/contracts/db'

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

/**
 * Delete a project.
 */
export async function deleteProject(id: string): Promise<void> {
    const supabase = createClient()
    const { data: project, error: fetchError } = await supabase
        .from('projects')
        .select('source_object_key')
        .eq('id', id)
        .maybeSingle()

    if (fetchError) throw fetchError
    if (!project) return

    if (project.source_object_key) {
        const { error: storageError } = await supabase.storage
            .from('media')
            .remove([project.source_object_key])

        if (storageError && !isMissingStorageObjectError(storageError)) throw storageError

        if (storageError) {
            console.warn(
                `[deleteProject] Storage object already missing: ${project.source_object_key}`,
                storageError.message
            )
        }
    }

    const { error } = await supabase.from('projects').delete().eq('id', id)

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
 * - Default `orderColumn` is `start_ms`, used by transcript segments.
 * - This helper only supports `segments`; use `paginateAllRows`
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
            `[fetchAllRows] Unsupported table "${table}" for orderColumn "${normalizedOrderColumn}". Supported tables: segments.`
        )
    }

    const supabase = createClient()
    return paginateAllRows<T>(supabase, table, projectId, normalizedOrderColumn)
}

/**
 * Fetch all segments for a project.
 */
export async function fetchSegments(projectId: string): Promise<Segment[]> {
    return fetchAllRows<Segment>('segments', projectId)
}

/**
 * Fetch transcript data for editor display.
 * Returns normalized data structure compatible with editor.
 */
export async function fetchTranscriptData(projectId: string): Promise<{
    items: Segment[]
}> {
    const segments = await fetchSegments(projectId)
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
