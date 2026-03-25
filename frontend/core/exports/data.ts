/**
 * Shared data-fetching logic for export routes.
 *
 * Centralizes authentication, project/chunks/speakers fetching,
 * and speaker map building for DOCX and VTT exports.
 */
import { SupabaseClient } from '@supabase/supabase-js'
import type { Chunk, Speaker, Project } from '@/contracts/db'
import type { ExportChunk, SpeakersMap } from '@/core/exports'
import { paginateAllRows } from '@/lib/supabase/queries'

export interface ExportData {
    project: Project
    exportChunks: ExportChunk[]
    speakersMap: SpeakersMap
}

export interface ExportError {
    error: string
    status: number
}

export type ExportDataResult =
    | { success: true; data: ExportData }
    | { success: false; error: ExportError }

/**
 * Fetch all chunks for a project with pagination to avoid PostgREST's
 * default 1000-row limit truncating long transcripts.
 */
async function fetchAllProjectChunks(
    supabase: SupabaseClient,
    projectId: string
): Promise<Chunk[]> {
    return paginateAllRows<Chunk>(supabase, 'chunks', projectId, 'start_ms')
}

/**
 * Fetch all data needed for transcript export.
 *
 * Handles authentication check, project lookup, chunks, and speakers.
 * Returns structured data or error response details.
 */
export async function fetchExportData(
    supabase: SupabaseClient,
    projectId: string
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

    // Fetch project
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()

    if (projectError || !project) {
        return {
            success: false,
            error: { error: 'Project not found', status: 404 },
        }
    }

    // Fetch chunks
    let chunks: Chunk[] = []
    try {
        chunks = await fetchAllProjectChunks(supabase, projectId)
    } catch (error) {
        console.error('Error fetching chunks:', error)
        return {
            success: false,
            error: { error: 'Failed to fetch transcript data', status: 500 },
        }
    }

    // Fetch speakers
    const { data: speakers, error: speakersError } = await supabase
        .from('speakers')
        .select('*')
        .eq('project_id', projectId)

    if (speakersError) {
        console.error('Error fetching speakers:', speakersError)
        return {
            success: false,
            error: { error: 'Failed to fetch speaker data', status: 500 },
        }
    }

    // Build speakers map
    const speakersMap: SpeakersMap = {}
    for (const speaker of speakers || []) {
        speakersMap[speaker.id] = {
            label: speaker.label,
            color: speaker.color,
        }
    }

    // Convert chunks to export format
    const exportChunks: ExportChunk[] = chunks.map((chunk: Chunk) => ({
        speaker_id: chunk.speaker_id,
        start_ms: chunk.start_ms,
        end_ms: chunk.end_ms,
        text: chunk.text,
    }))

    return {
        success: true,
        data: {
            project: project as Project,
            exportChunks,
            speakersMap,
        },
    }
}
