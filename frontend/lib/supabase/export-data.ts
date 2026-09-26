/**
 * Shared data-fetching logic for export routes.
 *
 * Centralizes authentication, transcript/segments/speakers fetching,
 * and speaker label resolution for every export format.
 */
import { SupabaseClient } from '@supabase/supabase-js'
import type { Segment, Transcript } from '@/contracts/db'
import type { ExportSegment } from '@/core/exports'
import {
    resolveSpeakerPresentation,
    type LabelledPerson,
    type LabelledSpeaker,
    type SpeakerPresentation,
} from '@/core/speakers/labels'
import { paginateAllRows } from '@/lib/supabase/queries'

export interface ExportData {
    transcript: Transcript
    exportSegments: ExportSegment[]
    speakers: SpeakerPresentation
}

export interface ExportError {
    error: string
    status: number
}

export type ExportDataResult =
    | { success: true; data: ExportData }
    | { success: false; error: ExportError }

// A transcript speaker with its linked person and that person's organisation,
// embedded through the composite owner foreign keys.
type ExportSpeakerRow = LabelledSpeaker & {
    person: { id: string; name: string; organisation: { name: string } | null } | null
}

const EXPORT_SPEAKER_COLUMNS =
    'id, ordinal, custom_label, person_id, ' +
    'person:people!speakers_person_owner_fk(id, name, organisation:organisations!people_organisation_owner_fk(name))'

/**
 * Fetch all segments for a transcript with pagination to avoid PostgREST's
 * default 1000-row limit truncating long transcripts.
 */
async function fetchAllTranscriptSegments(
    supabase: SupabaseClient,
    transcriptId: string
): Promise<Segment[]> {
    return paginateAllRows<Segment>(supabase, 'segments', transcriptId, 'start_ms')
}

/**
 * Fetch all data needed for transcript export.
 *
 * Handles authentication check, transcript lookup, segments, and speakers.
 * Returns structured data or error response details.
 */
export async function fetchExportData(
    supabase: SupabaseClient,
    transcriptId: string
): Promise<ExportDataResult> {
    // Authenticate
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
        return {
            success: false,
            error: { error: 'Unauthorized', status: 401 },
        }
    }

    // Fetch transcript
    const { data: transcript, error: transcriptError } = await supabase
        .from('transcripts')
        .select('*')
        .eq('id', transcriptId)
        .single()

    if (transcriptError || !transcript) {
        return {
            success: false,
            error: { error: 'Transcript not found', status: 404 },
        }
    }

    // Fetch segments
    let segments: Segment[] = []
    try {
        segments = await fetchAllTranscriptSegments(supabase, transcriptId)
    } catch (error) {
        console.error('Error fetching segments:', error)
        return {
            success: false,
            error: { error: 'Failed to fetch transcript data', status: 500 },
        }
    }

    // Fetch speakers with their linked people
    const { data, error: speakersError } = await supabase
        .from('speakers')
        .select(EXPORT_SPEAKER_COLUMNS)
        .eq('transcript_id', transcriptId)

    if (speakersError) {
        console.error('Error fetching speakers:', speakersError)
        return {
            success: false,
            error: { error: 'Failed to fetch speaker data', status: 500 },
        }
    }

    const speakers = (data ?? []) as unknown as ExportSpeakerRow[]
    const people: LabelledPerson[] = speakers.flatMap(({ person }) => person
        ? [{ id: person.id, name: person.name, organisation_name: person.organisation?.name ?? null }]
        : [])

    // Convert DB segments to the lean export view model.
    const exportSegments: ExportSegment[] = segments.map((segment: Segment) => ({
        speaker_id: segment.speaker_id,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        text: segment.text,
    }))

    return {
        success: true,
        data: {
            transcript: transcript as Transcript,
            exportSegments,
            // Segments arrive in transcript order, which the resolver needs for
            // first appearance.
            speakers: resolveSpeakerPresentation(speakers, segments, people),
        },
    }
}
