/**
 * VTT Export API Route
 *
 * GET /api/transcripts/[id]/export/vtt
 *
 * Generates a WebVTT file from the transcript's transcript segments and speakers.
 * Requires authentication via Supabase session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { generateVtt, normalizeFilename } from '@/core/exports'
import { fetchExportData } from '@/core/exports/data'

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

    // Generate VTT
    const vttContent = generateVtt({
        segments: exportSegments,
        speakersMap,
        transcriptId,
    })

    // Create filename: {title}_VTT_{YYYY-MM-DD}.vtt
    const dateStr = new Date(transcript.created_at).toISOString().split('T')[0]
    const safeTitle = normalizeFilename(transcript.title || 'Transcript')
    const filename = `${safeTitle}_VTT_${dateStr}.vtt`

    // Return as downloadable file
    return new NextResponse(vttContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
