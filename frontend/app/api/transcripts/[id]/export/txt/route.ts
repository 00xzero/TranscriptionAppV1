/**
 * TXT Export API Route
 *
 * GET /api/transcripts/[id]/export/txt
 *
 * Generates a plain-text file from the transcript's segments and speakers.
 * Requires authentication via Supabase session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { generateTxt, normalizeFilename } from '@/core/exports'
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

    // Generate TXT
    const txtContent = generateTxt({
        transcriptTitle: transcript.title || 'Transcript',
        segments: exportSegments,
        speakersMap,
        transcriptionDate: new Date(transcript.created_at),
        durationSeconds: transcript.duration_seconds,
    })

    // Create filename: {title}_TXT_{YYYY-MM-DD}.txt
    const dateStr = new Date(transcript.created_at).toISOString().split('T')[0]
    const safeTitle = normalizeFilename(transcript.title || 'Transcript')
    const filename = `${safeTitle}_TXT_${dateStr}.txt`

    // Return as downloadable file
    return new NextResponse(txtContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
