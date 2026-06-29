/**
 * DOCX Export API Route
 *
 * GET /api/transcripts/[id]/export/docx
 *
 * Generates a DOCX file from the transcript's transcript segments and speakers.
 * Requires authentication via Supabase session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { generateDocx, normalizeFilename } from '@/core/exports'
import { fetchExportData } from '@/core/exports/data'

export const runtime = 'nodejs' // DOCX generation requires Node.js runtime

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: transcriptId } = await params
    const supabase = await createClient()

    // Fetch export data (handles auth, transcript, segments, speakers)
    const result = await fetchExportData(supabase, transcriptId)

    if (!result.success) {
        return NextResponse.json(
            { error: result.error.error },
            { status: result.error.status }
        )
    }

    const { transcript, exportSegments, speakersMap } = result.data

    // Generate DOCX
    const docxBuffer = await generateDocx({
        transcriptTitle: transcript.title || 'Transcript',
        segments: exportSegments,
        speakersMap,
        transcriptionDate: new Date(transcript.created_at),
        durationSeconds: transcript.duration_seconds,
    })

    // Create filename: {title}_DOCX_{YYYY-MM-DD}.docx
    const dateStr = new Date(transcript.created_at).toISOString().split('T')[0]
    const safeTitle = normalizeFilename(transcript.title || 'Transcript')
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
