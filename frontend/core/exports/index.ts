/**
 * Export utilities for generating DOCX, VTT, TXT, and Markdown transcript files.
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

export interface ExportSegment {
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
    const secs = Math.floor(seconds % 60)

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
    const normalizedMs = Math.max(0, ms)
    const totalSec = Math.floor(normalizedMs / 1000)
    const millis = normalizedMs % 1000
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
// Shared Segment Grouping
// ============================================================================

export interface SpeakerTurn {
    speakerLabel: string
    segments: ExportSegment[]
}

/**
 * Group consecutive segments into speaker turns. A new turn starts whenever the
 * speaker changes; consecutive null-speaker segments collapse into a single turn
 * via a stable key. Shared by the DOCX, TXT, and Markdown generators.
 */
export function groupSegmentsBySpeaker(
    segments: ExportSegment[],
    speakersMap: SpeakersMap,
    fallbackLabel = 'Unknown Speaker'
): SpeakerTurn[] {
    const turns: SpeakerTurn[] = []
    let currentKey: string | null = null

    for (const segment of segments) {
        const key = segment.speaker_id ?? '__null__'
        if (key !== currentKey) {
            currentKey = key
            turns.push({
                speakerLabel:
                    speakersMap[segment.speaker_id ?? '']?.label ?? fallbackLabel,
                segments: [],
            })
        }
        turns[turns.length - 1].segments.push(segment)
    }

    return turns
}

/**
 * Build the metadata line shown under the title in text-based exports (TXT and
 * Markdown), e.g. "July 4, 2026 · 5m 12s". DOCX uses its own metadata block and
 * does not call this.
 */
export function buildExportMetaLine(
    date: Date,
    durationSeconds?: number | null
): string {
    const dateStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
    return durationSeconds != null
        ? `${dateStr} · ${formatDuration(durationSeconds)}`
        : dateStr
}

/**
 * Collapse a segment body to a single line so it sits cleanly under its
 * timestamp prefix and cannot inject Markdown block syntax on a later line.
 */
function normalizeSegmentText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

// ============================================================================
// VTT Generation
// ============================================================================

export interface GenerateVttParams {
    segments: ExportSegment[]
    speakersMap: SpeakersMap
    transcriptId: string
}

/**
 * Escape special characters for VTT content.
 * Prevents breaking cues if text contains '<' or '&'.
 */
function escapeVttText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

/**
 * Generate a WebVTT file from transcript segments.
 *
 * @returns VTT content as string
 */
export function generateVtt({
    segments,
    speakersMap,
    transcriptId,
}: GenerateVttParams): string {
    const lines: string[] = ['WEBVTT', '']

    segments.forEach((segment, idx) => {
        const rawLabel =
            speakersMap[segment.speaker_id ?? '']?.label ?? 'Speaker'
        const speakerLabel = escapeVttText(rawLabel)
        const text = escapeVttText(segment.text)

        const startVtt = msToVttTimestamp(segment.start_ms)
        const endVtt = msToVttTimestamp(segment.end_ms)

        // Cue identifier format: {transcript_id}/{index}
        const cueId = `${transcriptId}/${idx}`

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
    transcriptTitle: string
    segments: ExportSegment[]
    speakersMap: SpeakersMap
    transcriptionDate: Date
    durationSeconds?: number | null
}

/**
 * Generate a DOCX file from transcript segments.
 *
 * @returns Promise resolving to Buffer of DOCX file
 */
export async function generateDocx({
    transcriptTitle,
    segments,
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
                    text: transcriptTitle || 'Transcript',
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

    // Transcript body - group segments into speaker turns
    for (const turn of groupSegmentsBySpeaker(segments, speakersMap)) {
        // Speaker header at the start of each turn
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: turn.speakerLabel,
                        bold: true,
                        size: 24, // 12pt
                    }),
                ],
                spacing: { before: 200 },
            })
        )

        for (const segment of turn.segments) {
            // Timestamp and text
            const timestampStr = msToTimestamp(segment.start_ms)
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
                            text: segment.text,
                            size: 22, // 11pt
                        }),
                    ],
                    spacing: { after: 100 },
                })
            )
        }
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

// ============================================================================
// Text-based Generation (TXT / Markdown)
// ============================================================================

export interface GenerateTextExportParams {
    transcriptTitle: string
    segments: ExportSegment[]
    speakersMap: SpeakersMap
    transcriptionDate: Date
    durationSeconds?: number | null
}

/**
 * Generate a plain-text (.txt) transcript, grouped by speaker turn with a
 * `[m:ss]` timestamp prefixing each segment.
 *
 * @returns TXT content as string
 */
export function generateTxt({
    transcriptTitle,
    segments,
    speakersMap,
    transcriptionDate,
    durationSeconds,
}: GenerateTextExportParams): string {
    const lines: string[] = [
        transcriptTitle || 'Transcript',
        buildExportMetaLine(transcriptionDate, durationSeconds),
    ]

    for (const turn of groupSegmentsBySpeaker(segments, speakersMap)) {
        lines.push('', turn.speakerLabel)
        for (const segment of turn.segments) {
            lines.push(
                `[${msToTimestamp(segment.start_ms)}] ${normalizeSegmentText(segment.text)}`
            )
        }
    }

    return lines.join('\n') + '\n'
}

/**
 * Escape inline Markdown metacharacters so transcript-derived text (segment
 * bodies, title, speaker labels) renders literally instead of triggering
 * emphasis, code spans, or links. Backticks are the critical case: the
 * timestamp prefix uses them and consecutive segment lines form a single
 * paragraph, so an unescaped backtick in one segment can pair with a later
 * timestamp and corrupt an entire speaker turn. The backslash is escaped first
 * (leading position in the class) so it cannot consume a following escape.
 *
 * Markdown-only — never applied to the plain-text (TXT) export, whose output
 * has no Markdown semantics and would only be uglified by backslashes.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_[\]]/g, '\\$&')
}

/**
 * Generate a Markdown (.md) transcript: `#` title, italic metadata line, bold
 * speaker headings, and an inline-code `[m:ss]` timestamp prefixing each
 * segment. Segment bodies are normalized to a single line (block-level safety)
 * and inline metacharacters are escaped (inline safety), so transcript text —
 * including edited segments and speaker labels — cannot break rendering.
 *
 * @returns Markdown content as string
 */
export function generateMarkdown({
    transcriptTitle,
    segments,
    speakersMap,
    transcriptionDate,
    durationSeconds,
}: GenerateTextExportParams): string {
    const lines: string[] = [
        `# ${escapeMarkdown(transcriptTitle || 'Transcript')}`,
        `_${buildExportMetaLine(transcriptionDate, durationSeconds)}_`,
    ]

    for (const turn of groupSegmentsBySpeaker(segments, speakersMap)) {
        lines.push('', `**${escapeMarkdown(turn.speakerLabel)}**`)
        for (const segment of turn.segments) {
            lines.push(
                `\`[${msToTimestamp(segment.start_ms)}]\` ${escapeMarkdown(normalizeSegmentText(segment.text))}`
            )
        }
    }

    return lines.join('\n') + '\n'
}
