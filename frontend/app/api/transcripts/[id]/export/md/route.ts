/**
 * Markdown Export API Route
 *
 * GET /api/transcripts/[id]/export/md
 *
 * Generates a Markdown file from the transcript's segments and speakers.
 * Requires authentication via Supabase session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/infra/supabase/server'
import { generateMarkdown, normalizeFilename } from '@/core/exports'
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

    // Generate Markdown
    const mdContent = generateMarkdown({
        transcriptTitle: transcript.title || 'Transcript',
        segments: exportSegments,
        speakersMap,
        transcriptionDate: new Date(transcript.created_at),
        durationSeconds: transcript.duration_seconds,
    })

    // Create filename: {title}_MD_{YYYY-MM-DD}.md
    const dateStr = new Date(transcript.created_at).toISOString().split('T')[0]
    const safeTitle = normalizeFilename(transcript.title || 'Transcript')
    const filename = `${safeTitle}_MD_${dateStr}.md`

    // Return as downloadable file
    return new NextResponse(mdContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    })
}
