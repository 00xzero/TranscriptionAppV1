/**
 * DOCX Export API Route
 *
 * GET /api/projects/[id]/export/docx
 *
 * Generates a DOCX file from the project's transcript chunks and speakers.
 * Requires authentication via Supabase session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDocx, normalizeFilename } from '@/lib/exports'
import type { Chunk, Speaker, Project } from '@/lib/supabase/types'

export const runtime = 'nodejs' // DOCX generation requires Node.js runtime

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: projectId } = await params

    // Authenticate
    const supabase = await createClient()
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch project
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()

    if (projectError || !project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Fetch chunks
    const { data: chunks, error: chunksError } = await supabase
        .from('chunks')
        .select('*')
        .eq('project_id', projectId)
        .order('start_ms', { ascending: true })

    if (chunksError) {
        console.error('Error fetching chunks:', chunksError)
        return NextResponse.json(
            { error: 'Failed to fetch transcript data' },
            { status: 500 }
        )
    }

    // Fetch speakers
    const { data: speakers, error: speakersError } = await supabase
        .from('speakers')
        .select('*')
        .eq('project_id', projectId)

    if (speakersError) {
        console.error('Error fetching speakers:', speakersError)
        return NextResponse.json(
            { error: 'Failed to fetch speaker data' },
            { status: 500 }
        )
    }

    // Build speakers map
    const speakersMap: Record<string, { label: string; color?: string | null }> =
        {}
    for (const speaker of speakers || []) {
        speakersMap[speaker.id] = {
            label: speaker.label,
            color: speaker.color,
        }
    }

    // Convert chunks to export format
    const exportChunks = (chunks || []).map((chunk: Chunk) => ({
        speaker_id: chunk.speaker_id,
        start_ms: chunk.start_ms,
        end_ms: chunk.end_ms,
        text: chunk.text,
    }))

    // Generate DOCX
    const docxBuffer = await generateDocx({
        projectTitle: (project as Project).title || 'Transcript',
        chunks: exportChunks,
        speakersMap,
        transcriptionDate: new Date((project as Project).created_at),
        durationSeconds: (project as Project).duration_seconds,
    })

    // Create filename: {title}_DOCX_{YYYY-MM-DD}.docx
    const dateStr = new Date((project as Project).created_at)
        .toISOString()
        .split('T')[0]
    const safeTitle = normalizeFilename((project as Project).title || 'Transcript')
    const filename = `${safeTitle}_DOCX_${dateStr}.docx`

    // Return as downloadable file
    return new NextResponse(docxBuffer, {
        status: 200,
        headers: {
            'Content-Type':
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
