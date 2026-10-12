/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on transcripts, transcript rows, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from '@/infra/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
    EditorPeopleContext,
    LocalSpeakerResult,
    MergePreview,
    NewSpeakerSegmentChange,
    Organisation,
    PeopleDirectory,
    Person,
    PersonAppearance,
    PersonCorrectionResult,
    PersonOrganisationResult,
    Transcript,
    Project,
    ProjectSpeakerSummary,
    Speaker,
    SegmentUpdate,
    SegmentSpeakerChange,
    SegmentSpeakerAssignment,
    TranscriptSummary,
    TranscriptUpdate,
    Segment,
} from '@/contracts/db'
import {
    EditorPeopleContextSchema,
    LocalSpeakerResultSchema,
    MergePreviewSchema,
    NewSpeakerSegmentChangeSchema,
    OrganisationSchema,
    PeopleDirectorySchema,
    PersonAppearancesSchema,
    PersonCorrectionResultSchema,
    PersonOrganisationResultSchema,
    PersonSchema,
    ProjectSpeakerSummariesResultSchema,
    ReassignSegmentsResultSchema,
    RemovePersonResultSchema,
    SegmentSpeakerChangeSchema,
    SpeakerSchema,
    TranscriptSummarySchema,
} from '@/contracts/db'
import type { EditorSourceWord } from '@/contracts/editor'
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
 * Fetch every stored Deepgram word of a transcript, in segment and spoken
 * order. The empty `segments!inner()` embed filters by transcript without
 * returning segment columns. Rows are unvalidated; see groupSourceWords.
 */
export async function fetchTranscriptWords(transcriptId: string): Promise<EditorSourceWord[]> {
    const supabase = createClient()
    return paginateRows<EditorSourceWord>((from, to) =>
        supabase
            .from('words')
            .select('id, segment_id, start_ms, end_ms, text, punctuated_text, order_index, segments!inner()')
            .eq('segments.transcript_id', transcriptId)
            .order('segment_id', { ascending: true })
            .order('order_index', { ascending: true })
            .order('id', { ascending: true }) // tie-breaker for deterministic pagination
            .range(from, to) as unknown as PromiseLike<PageResult<EditorSourceWord>>
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
        // Only for a stable order: labels and colours follow first appearance
        // in the transcript, not this list.
        .order('ordinal', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Rename a speaker that has a transcript-local label. `expectedCustomLabel` is
 * the value last read; the database refuses the write if it has changed since.
 */
export async function setSpeakerCustomLabel(
    speakerId: string,
    expectedCustomLabel: string,
    customLabel: string
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
 * speaker the segment is expected to hold and its new speaker.
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

// ============================================================================
// People (speaker identity)
// ============================================================================

/**
 * The editor picker's directory: every person the user owns, with each
 * person's appearances in transcripts other than this one.
 */
export async function fetchEditorPeopleContext(transcriptId: string): Promise<EditorPeopleContext> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('editor_people_context', {
        p_transcript_id: transcriptId,
    })

    if (error) throw error
    return EditorPeopleContextSchema.parse(data)
}

/**
 * Rename a person everywhere. `expectedName` is the name last read.
 */
export async function renamePerson(
    personId: string,
    expectedName: string,
    name: string
): Promise<Person> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('rename_person_guarded', {
        p_person_id: personId,
        p_expected_name: expectedName,
        p_name: name,
    })

    if (error) throw error
    return PersonSchema.parse(data)
}

/**
 * Name a detected speaker in this transcript only: the segments move to a new
 * speaker with the label, as one operation.
 */
export async function createLocalSpeaker(
    transcriptId: string,
    customLabel: string,
    changes: NewSpeakerSegmentChange[]
): Promise<LocalSpeakerResult> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_local_speaker', {
        p_transcript_id: transcriptId,
        p_custom_label: customLabel,
        p_changes: z.array(NewSpeakerSegmentChangeSchema).parse(changes),
    })

    if (error) throw error
    return LocalSpeakerResultSchema.parse(data)
}

/**
 * Move segments to an existing or new person, as one operation. The database
 * reuses the person's speaker in this transcript or creates one.
 */
export async function correctSegmentsToPerson(
    transcriptId: string,
    changes: NewSpeakerSegmentChange[],
    target: { personId: string } | { newPersonName: string }
): Promise<PersonCorrectionResult> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('correct_segments_to_person', {
        p_transcript_id: transcriptId,
        p_changes: z.array(NewSpeakerSegmentChangeSchema).parse(changes),
        p_person_id: 'personId' in target ? target.personId : null,
        p_new_person_name: 'newPersonName' in target ? target.newPersonName : null,
    })

    if (error) throw error
    return PersonCorrectionResultSchema.parse(data)
}

/**
 * Undo a correction that created a person: move the segments back and delete
 * the person. The database refuses if anything the correction wrote has
 * changed since, judged by the person's `updated_at`.
 */
export async function undoCreatedPerson(args: {
    transcriptId: string
    speakerId: string
    person: Pick<Person, 'id' | 'updated_at'>
    changes: SegmentSpeakerChange[]
}): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.rpc('undo_created_person_action', {
        p_transcript_id: args.transcriptId,
        p_person_id: args.person.id,
        p_person_updated_at: args.person.updated_at,
        p_speaker_id: args.speakerId,
        p_changes: z.array(SegmentSpeakerChangeSchema).parse(args.changes),
    })

    if (error) throw error
}

// ============================================================================
// People directory
// ============================================================================

/**
 * Every person the user owns, with their organisation, appearance count and
 * last seen date, and every organisation with its number of people.
 */
export async function fetchPeopleDirectory(): Promise<PeopleDirectory> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('people_directory')

    if (error) throw error
    return PeopleDirectorySchema.parse(data)
}

/**
 * The transcripts a person appears in, newest first.
 */
export async function fetchPersonAppearances(personId: string): Promise<PersonAppearance[]> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('list_person_appearances', {
        p_person_id: personId,
    })

    if (error) throw error
    return PersonAppearancesSchema.parse(data ?? [])
}

/**
 * What merging `personIds` into the survivor would move. `personIds` keeps the
 * order the user picked them in.
 */
export async function fetchMergePreview(survivorId: string, personIds: string[]): Promise<MergePreview> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('merge_people_preview', {
        p_survivor_id: survivorId,
        p_person_ids: personIds,
    })

    if (error) throw error
    return MergePreviewSchema.parse(data)
}

/**
 * Create a person from the directory. Duplicate names are allowed.
 */
export async function createPerson(name: string): Promise<Person> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_person', { p_name: name })

    if (error) throw error
    return PersonSchema.parse(data)
}

/**
 * Set, change or clear a person's organisation. A new name reuses an
 * organisation already called that, ignoring case. `expectedOrganisationId`
 * is the value last read.
 */
export async function setPersonOrganisation(
    personId: string,
    expectedOrganisationId: string | null,
    target: { organisationId: string } | { newOrganisationName: string } | null
): Promise<PersonOrganisationResult> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('set_person_organisation', {
        p_person_id: personId,
        p_expected_organisation_id: expectedOrganisationId,
        p_organisation_id: target && 'organisationId' in target ? target.organisationId : null,
        p_new_organisation_name: target && 'newOrganisationName' in target ? target.newOrganisationName : null,
    })

    if (error) throw error
    return PersonOrganisationResultSchema.parse(data)
}

/**
 * Change a person's preferred colour to another palette colour.
 */
export async function setPersonColor(personId: string, expectedColor: string, color: string): Promise<Person> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('set_person_color', {
        p_person_id: personId,
        p_expected_color: expectedColor,
        p_color: color,
    })

    if (error) throw error
    return PersonSchema.parse(data)
}

/**
 * Hide or unhide a person. Hiding only affects suggestions and the list.
 */
export async function setPersonHidden(personId: string, hidden: boolean): Promise<Person> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('set_person_hidden', {
        p_person_id: personId,
        p_hidden: hidden,
    })

    if (error) throw error
    return PersonSchema.parse(data)
}

/**
 * Delete a person who appears in no transcript. The database refuses (SP002)
 * while any transcript still shows them.
 */
export async function deletePerson(personId: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_person', { p_person_id: personId })

    if (error) throw error
}

/**
 * Send every segment showing the person in one transcript back to what
 * Deepgram gave it. Returns the changes made, for Undo.
 */
export async function removePersonFromTranscript(
    personId: string,
    transcriptId: string
): Promise<SegmentSpeakerChange[]> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('remove_person_from_transcript', {
        p_person_id: personId,
        p_transcript_id: transcriptId,
    })

    if (error) throw error
    return RemovePersonResultSchema.parse(data)
}

/**
 * Fold people into a survivor, in one transaction. `personIds` keeps the order
 * the user picked them in: a survivor without an organisation takes the first
 * one among them.
 */
export async function mergePeople(survivorId: string, personIds: string[], preview: MergePreview): Promise<Person> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('merge_people', {
        p_survivor_id: survivorId,
        p_person_ids: personIds,
        p_expected_preview: MergePreviewSchema.parse(preview),
    })

    if (error) throw error
    return PersonSchema.parse(data)
}

/**
 * Rename an organisation everywhere. `expectedName` is the name last read.
 */
export async function renameOrganisation(
    organisationId: string,
    expectedName: string,
    name: string
): Promise<Organisation> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('rename_organisation', {
        p_organisation_id: organisationId,
        p_expected_name: expectedName,
        p_name: name,
    })

    if (error) throw error
    return OrganisationSchema.parse(data)
}

/**
 * Delete an organisation. Its people lose it; no person is deleted.
 */
export async function deleteOrganisation(organisationId: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_organisation', { p_organisation_id: organisationId })

    if (error) throw error
}
