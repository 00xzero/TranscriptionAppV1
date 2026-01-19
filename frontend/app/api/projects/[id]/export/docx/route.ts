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
import { fetchExportData } from '@/lib/exports/data'

export const runtime = 'nodejs' // DOCX generation requires Node.js runtime

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: projectId } = await params
    const supabase = await createClient()

    // Fetch export data (handles auth, project, chunks, speakers)
    const result = await fetchExportData(supabase, projectId)

    if (!result.success) {
        return NextResponse.json(
            { error: result.error.error },
            { status: result.error.status }
        )
    }

    const { project, exportChunks, speakersMap } = result.data

    // Generate DOCX
    const docxBuffer = await generateDocx({
        projectTitle: project.title || 'Transcript',
        chunks: exportChunks,
        speakersMap,
        transcriptionDate: new Date(project.created_at),
        durationSeconds: project.duration_seconds,
    })

    // Create filename: {title}_DOCX_{YYYY-MM-DD}.docx
    const dateStr = new Date(project.created_at).toISOString().split('T')[0]
    const safeTitle = normalizeFilename(project.title || 'Transcript')
    const filename = `${safeTitle}_DOCX_${dateStr}.docx`

    // Return as downloadable file (convert Buffer to Uint8Array for NextResponse)
    return new NextResponse(new Uint8Array(docxBuffer), {
        status: 200,
        headers: {
            'Content-Type':
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
