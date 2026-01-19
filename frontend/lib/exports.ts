/**
 * Export utilities for generating DOCX and VTT transcript files.
 *
 * Port of backend/app/services/exports.py to TypeScript for Next.js API routes.
 */
import {
    Document,
    Paragraph,
    TextRun,
    AlignmentType,
    Packer,
} from 'docx'

// ============================================================================
// Types
// ============================================================================

export interface ExportChunk {
    speaker_id: string | null
    start_ms: number
    end_ms: number
    text: string
}

export interface ExportSpeaker {
    label: string
    color?: string | null
}

export type SpeakersMap = Record<string, ExportSpeaker>

// ============================================================================
// Time Formatting Helpers
// ============================================================================

/**
 * Convert seconds to human-readable duration format.
 *
 * @example
 * formatDuration(3898) // "1h 4m 58s"
 * formatDuration(125)  // "2m 5s"
 * formatDuration(45)   // "45s"
 */
export function formatDuration(seconds: number): string {
    if (seconds < 0) seconds = 0

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    const parts: string[] = []
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

    return parts.join(' ')
}

/**
 * Convert milliseconds to MM:SS or H:MM:SS format.
 *
 * @example
 * msToTimestamp(4205)    // "0:04"
 * msToTimestamp(65000)   // "1:05"
 * msToTimestamp(3665000) // "1:01:05"
 */
export function msToTimestamp(ms: number): string {
    const totalSec = Math.floor(Math.max(0, ms) / 1000)
    const s = totalSec % 60
    const m = Math.floor((totalSec / 60) % 60)
    const h = Math.floor(totalSec / 3600)

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Convert milliseconds to VTT timestamp format (HH:MM:SS.mmm).
 *
 * @example
 * msToVttTimestamp(4205)  // "00:00:04.205"
 * msToVttTimestamp(65000) // "00:01:05.000"
 */
export function msToVttTimestamp(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const millis = ms % 1000
    const s = totalSec % 60
    const m = Math.floor((totalSec / 60) % 60)
    const h = Math.floor(totalSec / 3600)

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

/**
 * Normalize a string for use in filenames.
 * Removes special characters and replaces spaces with underscores.
 */
export function normalizeFilename(name: string): string {
    return name
        .replace(/[^\w\s-]/g, '') // Remove special chars except word chars, spaces, hyphens
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/_+/g, '_') // Collapse multiple underscores
        .replace(/^_|_$/g, '') // Trim leading/trailing underscores
        .substring(0, 100) // Limit length
}

// ============================================================================
// VTT Generation
// ============================================================================

export interface GenerateVttParams {
    chunks: ExportChunk[]
    speakersMap: SpeakersMap
    projectId: string
}

/**
 * Escape special characters for VTT content.
 * Prevents breaking cues if text contains '<' or '&'.
 */
function escapeVttText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/**
 * Generate a WebVTT file from transcript chunks.
 *
 * @returns VTT content as string
 */
export function generateVtt({
    chunks,
    speakersMap,
    projectId,
}: GenerateVttParams): string {
    const lines: string[] = ['WEBVTT', '']

    chunks.forEach((chunk, idx) => {
        const rawLabel =
            speakersMap[chunk.speaker_id ?? '']?.label ?? 'Speaker'
        const speakerLabel = escapeVttText(rawLabel)
        const text = escapeVttText(chunk.text)

        const startVtt = msToVttTimestamp(chunk.start_ms)
        const endVtt = msToVttTimestamp(chunk.end_ms)

        // Cue identifier format: {project_id}/{index}
        const cueId = `${projectId}/${idx}`

        lines.push(cueId)
        lines.push(`${startVtt} --> ${endVtt}`)
        lines.push(`<v ${speakerLabel}>${text}</v>`)
        lines.push('')
    })

    return lines.join('\n')
}

// ============================================================================
// DOCX Generation
// ============================================================================

export interface GenerateDocxParams {
    projectTitle: string
    chunks: ExportChunk[]
    speakersMap: SpeakersMap
    transcriptionDate: Date
    durationSeconds?: number | null
}

/**
 * Generate a DOCX file from transcript chunks.
 *
 * @returns Promise resolving to Buffer of DOCX file
 */
export async function generateDocx({
    projectTitle,
    chunks,
    speakersMap,
    transcriptionDate,
    durationSeconds,
}: GenerateDocxParams): Promise<Buffer> {
    const children: Paragraph[] = []

    // Title - centered, 16pt bold
    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: projectTitle || 'Transcript',
                    bold: true,
                    size: 32, // 16pt = 32 half-points
                }),
            ],
        })
    )

    // Metadata block - centered, smaller font, gray
    const dateStr = transcriptionDate.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })

    const metaRuns: TextRun[] = [
        new TextRun({
            text: dateStr,
            size: 20, // 10pt
            color: '808080',
        }),
    ]

    if (durationSeconds != null) {
        metaRuns.push(
            new TextRun({
                text: '\n' + formatDuration(durationSeconds),
                size: 20,
                color: '808080',
                break: 1,
            })
        )
    }

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: metaRuns,
        })
    )

    // Spacer
    children.push(new Paragraph({ children: [] }))

    // Transcript body - group chunks by speaker turns
    // Use stable key to ensure null speakers get a header on first occurrence
    let currentSpeakerKey: string | null = null

    for (const chunk of chunks) {
        const speakerKey = chunk.speaker_id ?? '__null__'
        const speakerLabel =
            speakersMap[chunk.speaker_id ?? '']?.label ?? 'Unknown Speaker'

        // Check if we need a new speaker label
        if (speakerKey !== currentSpeakerKey) {
            currentSpeakerKey = speakerKey
            children.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: speakerLabel,
                            bold: true,
                            size: 24, // 12pt
                        }),
                    ],
                    spacing: { before: 200 },
                })
            )
        }

        // Timestamp and text
        const timestampStr = msToTimestamp(chunk.start_ms)
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: timestampStr,
                        size: 20, // 10pt
                        color: '646464',
                    }),
                ],
            })
        )
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: chunk.text,
                        size: 22, // 11pt
                    }),
                ],
                spacing: { after: 100 },
            })
        )
    }

    // Create document
    const doc = new Document({
        sections: [
            {
                children,
            },
        ],
    })

    // Convert to buffer (Node.js native, returns Buffer which extends Uint8Array)
    return await Packer.toBuffer(doc)
}
