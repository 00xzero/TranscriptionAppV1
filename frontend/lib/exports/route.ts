import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { generateDocx, generateMarkdown, generateTxt, generateVtt, normalizeFilename } from '@/core/exports'
import { createClient } from '@/infra/supabase/server'
import { fetchExportData, type ExportData } from '@/lib/supabase/export-data'
import { normalizeDownloadTitle } from './filename'

function documentOptions({ transcript, exportSegments, speakers }: ExportData) {
  return {
    transcriptTitle: transcript.title || 'Transcript',
    segments: exportSegments,
    speakers,
    transcriptionDate: new Date(transcript.created_at),
    durationSeconds: transcript.duration_seconds,
  }
}

const formats = {
  docx: {
    label: 'DOCX',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    render: async (data: ExportData) => new Uint8Array(await generateDocx(documentOptions(data))),
  },
  md: {
    label: 'MD',
    contentType: 'text/markdown; charset=utf-8',
    render: (data: ExportData) => generateMarkdown(documentOptions(data)),
  },
  txt: {
    label: 'TXT',
    contentType: 'text/plain; charset=utf-8',
    render: (data: ExportData) => generateTxt(documentOptions(data)),
  },
  vtt: {
    label: 'VTT',
    contentType: 'text/vtt; charset=utf-8',
    render: (data: ExportData, transcriptId: string) => generateVtt({
      segments: data.exportSegments,
      speakers: data.speakers,
      transcriptId,
    }),
  },
} as const

/** Server-side transport shared by the four format-specific route entrypoints. */
export function createExportHandler(format: keyof typeof formats) {
  const config = formats[format]
  return async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id: transcriptId } = await params
    await using supabase = await createClient({ refreshSession: true })
    const result = await fetchExportData(supabase, transcriptId)
    if (!result.success) {
      return NextResponse.json({ error: result.error.error }, { status: result.error.status })
    }

    const title = result.data.transcript.title || 'Transcript'
    const date = new Date(result.data.transcript.created_at).toISOString().split('T')[0]
    const suffix = `_${config.label}_${date}.${format}`
    const fallback = `${normalizeFilename(title) || 'Transcript'}${suffix}`
    const filename = `${normalizeDownloadTitle(title)}${suffix}`
    const content = await config.render(result.data, transcriptId)
    return new NextResponse(content, {
      headers: {
        'Content-Type': config.contentType,
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  }
}
