/** @jest-environment node */
/**
 * Unit tests for export utilities.
 *
 * Tests ported from backend/tests/test_exports.py
 * Run with: npm test -- --testPathPatterns=exports
 */
import {
    formatDuration,
    msToTimestamp,
    msToVttTimestamp,
    normalizeFilename,
    generateVtt,
    generateTxt,
    generateMarkdown,
    generateDocx,
    groupSegmentsBySpeaker,
    buildExportMetaLine,
    type ExportSpeakers,
} from '../core/exports'
import { UNKNOWN_SPEAKER_LABEL } from '../core/speakers/labels'
import JSZip from 'jszip'

// Labels only: each speaker is its own identity and there are no participants.
const speakersOf = (labels: Map<string, string>, participants: string[] = []): ExportSpeakers =>
    ({ labels, identityKeys: new Map(), participants })

describe('formatDuration', () => {
    it('formats hours, minutes, and seconds', () => {
        expect(formatDuration(3898)).toBe('1h 4m 58s')
    })

    it('formats minutes and seconds only', () => {
        expect(formatDuration(125)).toBe('2m 5s')
    })

    it('formats seconds only', () => {
        expect(formatDuration(45)).toBe('45s')
    })

    it('formats exact hour', () => {
        expect(formatDuration(3600)).toBe('1h')
    })

    it('formats exact minute', () => {
        expect(formatDuration(60)).toBe('1m')
    })

    it('returns 0s for zero duration', () => {
        expect(formatDuration(0)).toBe('0s')
    })

    it('returns 0s for negative value', () => {
        expect(formatDuration(-100)).toBe('0s')
    })
})

describe('msToTimestamp', () => {
    it('formats short timestamp (< 1 hour)', () => {
        expect(msToTimestamp(4205)).toBe('0:04')
        expect(msToTimestamp(65000)).toBe('1:05')
    })

    it('formats long timestamp (>= 1 hour)', () => {
        expect(msToTimestamp(3665000)).toBe('1:01:05')
    })

    it('handles zero milliseconds', () => {
        expect(msToTimestamp(0)).toBe('0:00')
    })
})

describe('msToVttTimestamp', () => {
    it('formats VTT timestamp with milliseconds', () => {
        expect(msToVttTimestamp(4205)).toBe('00:00:04.205')
        expect(msToVttTimestamp(65000)).toBe('00:01:05.000')
        expect(msToVttTimestamp(3665000)).toBe('01:01:05.000')
    })

    it('handles zero milliseconds', () => {
        expect(msToVttTimestamp(0)).toBe('00:00:00.000')
    })
})

describe('normalizeFilename', () => {
    it('replaces spaces with underscores', () => {
        expect(normalizeFilename('hello world')).toBe('hello_world')
    })

    it('removes special characters', () => {
        expect(normalizeFilename('test@file#name!')).toBe('testfilename')
    })

    it('handles empty string', () => {
        expect(normalizeFilename('')).toBe('')
    })

    it('collapses multiple underscores', () => {
        expect(normalizeFilename('hello   world')).toBe('hello_world')
    })

    it('trims leading underscores', () => {
        expect(normalizeFilename('  leading spaces')).toBe('leading_spaces')
    })

    it('trims trailing underscores', () => {
        expect(normalizeFilename('trailing spaces  ')).toBe('trailing_spaces')
    })

    it('truncates to 100 characters', () => {
        const longName = 'a'.repeat(150)
        const result = normalizeFilename(longName)
        expect(result.length).toBe(100)
    })

    it('preserves hyphens', () => {
        expect(normalizeFilename('my-file-name')).toBe('my-file-name')
    })
})

describe('generateVtt', () => {
    const sampleSegments = [
        {
            speaker_id: 's1',
            start_ms: 4205,
            end_ms: 10243,
            text: 'Hello world.',
        },
        {
            speaker_id: 's2',
            start_ms: 10500,
            end_ms: 15000,
            text: 'Response.',
        },
    ]

    const sampleSpeakers = new Map([
        ['s1', 'Speaker One'],
        ['s2', 'Speaker Two'],
    ])

    it('returns a string', () => {
        const result = generateVtt({
            segments: sampleSegments,
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(typeof result).toBe('string')
    })

    it('starts with WEBVTT header', () => {
        const result = generateVtt({
            segments: sampleSegments,
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(result.startsWith('WEBVTT')).toBe(true)
    })

    it('contains speaker voice tags', () => {
        const result = generateVtt({
            segments: sampleSegments,
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(result).toContain('<v Speaker One>')
        expect(result).toContain('<v Speaker Two>')
    })

    it('contains cue identifiers', () => {
        const result = generateVtt({
            segments: sampleSegments,
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(result).toContain('test-transcript/0')
        expect(result).toContain('test-transcript/1')
    })

    it('contains properly formatted timestamps', () => {
        const result = generateVtt({
            segments: sampleSegments,
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(result).toContain('00:00:04.205 --> 00:00:10.243')
    })

    it('handles empty segments array', () => {
        const result = generateVtt({
            segments: [],
            speakers: speakersOf(new Map()),
            transcriptId: 'test-transcript',
        })
        expect(result).toBe('WEBVTT\n')
    })

    it('escapes a speaker label so it cannot close or split the voice tag', () => {
        const result = generateVtt({
            segments: [{ speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'Hi.' }],
            speakers: speakersOf(new Map([['s1', 'A>B & <C>\nD']])),
            transcriptId: 'test-transcript',
        })
        expect(result).toContain('<v A&gt;B &amp; &lt;C&gt; D>Hi.</v>')
    })

    it('voices an unassigned segment as Unknown speaker', () => {
        const result = generateVtt({
            segments: [{ speaker_id: null, start_ms: 0, end_ms: 1000, text: 'Anon.' }],
            speakers: speakersOf(sampleSpeakers),
            transcriptId: 'test-transcript',
        })
        expect(result).toContain('<v Unknown speaker>Anon.</v>')
    })
})

// ============================================================================
// Shared helpers for text-based export tests
// ============================================================================

const textSegments = [
    { speaker_id: 's1', start_ms: 0, end_ms: 8000, text: 'Hello everyone, thanks for joining.' },
    { speaker_id: 's1', start_ms: 8000, end_ms: 12000, text: "Let's get started." },
    { speaker_id: 's2', start_ms: 12000, end_ms: 15000, text: 'Happy to be here.' },
]

const textSpeakers = new Map([
    ['s1', 'Speaker 1'],
    ['s2', 'Speaker 2'],
])

const sampleDate = new Date('2026-07-04T12:00:00Z')

describe('groupSegmentsBySpeaker', () => {
    it('groups adjacent local voices that resolve to the same person', () => {
        const turns = groupSegmentsBySpeaker([
            { speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'First' },
            { speaker_id: 's2', start_ms: 1000, end_ms: 2000, text: 'Second' },
        ], {
            labels: new Map([['s1', 'Alex'], ['s2', 'Alex']]),
            identityKeys: new Map([['s1', 'person:p1'], ['s2', 'person:p1']]),
        })
        expect(turns).toHaveLength(1)
        expect(turns[0].segments).toHaveLength(2)
    })
    it('groups consecutive same-speaker segments into one turn', () => {
        const turns = groupSegmentsBySpeaker(textSegments, speakersOf(textSpeakers))
        expect(turns).toHaveLength(2)
        expect(turns[0].speakerLabel).toBe('Speaker 1')
        expect(turns[0].segments).toHaveLength(2)
        expect(turns[1].speakerLabel).toBe('Speaker 2')
        expect(turns[1].segments).toHaveLength(1)
    })

    it('labels unassigned segments Unknown speaker and collapses them into one turn', () => {
        const turns = groupSegmentsBySpeaker(
            [
                { speaker_id: null, start_ms: 0, end_ms: 1000, text: 'Anon.' },
                { speaker_id: null, start_ms: 1000, end_ms: 2000, text: 'Still anon.' },
            ],
            speakersOf(new Map())
        )
        expect(turns).toHaveLength(1)
        expect(turns[0].speakerLabel).toBe(UNKNOWN_SPEAKER_LABEL)
        expect(UNKNOWN_SPEAKER_LABEL).toBe('Unknown speaker')
    })

    it('labels a speaker id missing from the labels Unknown speaker', () => {
        const turns = groupSegmentsBySpeaker(
            [{ speaker_id: 'gone', start_ms: 0, end_ms: 1000, text: 'Anon.' }],
            speakersOf(textSpeakers)
        )
        expect(turns[0].speakerLabel).toBe('Unknown speaker')
    })

    it('keeps two speakers missing from the labels as separate turns', () => {
        const turns = groupSegmentsBySpeaker([
            { speaker_id: 'gone-1', start_ms: 0, end_ms: 1000, text: 'One.' },
            { speaker_id: 'gone-2', start_ms: 1000, end_ms: 2000, text: 'Two.' },
            { speaker_id: null, start_ms: 2000, end_ms: 3000, text: 'Three.' },
        ], speakersOf(new Map()))
        expect(turns).toHaveLength(3)
    })

    it('returns an empty array for no segments', () => {
        expect(groupSegmentsBySpeaker([], speakersOf(new Map()))).toEqual([])
    })
})

test('DOCX, TXT and Markdown include participants; VTT keeps only voice labels', async () => {
    const params = { transcriptTitle: 'Review', transcriptionDate: sampleDate,
        segments: [
            { speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'Hello' },
            { speaker_id: null, start_ms: 1000, end_ms: 2000, text: 'Who?' },
        ], speakers: speakersOf(new Map([['s1', 'Alex']]), ['Alex — Example Org']) }
    expect(generateTxt(params)).toContain('Participants\nAlex — Example Org')
    expect(generateMarkdown(params)).toContain('**Participants**\nAlex — Example Org')
    const zip = await JSZip.loadAsync(await generateDocx(params))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Participants')
    expect(xml).toContain('Example Org')
    const vtt = generateVtt({ segments: params.segments, speakers: params.speakers, transcriptId: 't1' })
    expect(vtt).not.toContain('Participants')
    expect(vtt).toContain('<v Alex>Hello</v>')
    expect(vtt).toContain('<v Unknown speaker>Who?</v>')
})

describe('buildExportMetaLine', () => {
    it('appends duration with a middle dot when provided', () => {
        const line = buildExportMetaLine(sampleDate, 312)
        expect(line).toContain('2026')
        expect(line).toContain(' · 5m 12s')
    })

    it('omits the middle dot when duration is null', () => {
        const line = buildExportMetaLine(sampleDate, null)
        expect(line).not.toContain('·')
        expect(line).toContain('2026')
    })
})

describe('generateTxt', () => {
    const params = {
        transcriptTitle: 'Meeting Notes',
        segments: textSegments,
        speakers: speakersOf(textSpeakers),
        transcriptionDate: sampleDate,
        durationSeconds: 312,
    }

    it('returns a string starting with the title', () => {
        const result = generateTxt(params)
        expect(typeof result).toBe('string')
        expect(result.startsWith('Meeting Notes\n')).toBe(true)
    })

    it('includes the metadata line', () => {
        expect(generateTxt(params)).toContain('5m 12s')
    })

    it('renders speaker headers and timestamped segments', () => {
        const result = generateTxt(params)
        expect(result).toContain('Speaker 1')
        expect(result).toContain('Speaker 2')
        expect(result).toContain('[0:00] Hello everyone, thanks for joining.')
        expect(result).toContain('[0:08] Let\'s get started.')
        expect(result).toContain('[0:12] Happy to be here.')
    })

    it('normalizes multi-line segment text to a single line', () => {
        const result = generateTxt({
            ...params,
            segments: [{ speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'Line one.\n  Line two.' }],
        })
        expect(result).toContain('[0:00] Line one. Line two.')
    })

    it('emits only title and metadata for empty segments', () => {
        const result = generateTxt({ ...params, segments: [] })
        expect(result).not.toContain('Speaker')
        expect(result.startsWith('Meeting Notes\n')).toBe(true)
    })

    it('heads an unassigned turn Unknown speaker', () => {
        const result = generateTxt({
            ...params,
            segments: [{ speaker_id: null, start_ms: 0, end_ms: 1000, text: 'Anon.' }],
        })
        expect(result).toContain('\nUnknown speaker\n[0:00] Anon.')
    })
})

describe('generateMarkdown', () => {
    const params = {
        transcriptTitle: 'Meeting Notes',
        segments: textSegments,
        speakers: speakersOf(textSpeakers),
        transcriptionDate: sampleDate,
        durationSeconds: 312,
    }

    it('renders an H1 title and italic metadata line', () => {
        const result = generateMarkdown(params)
        expect(result.startsWith('# Meeting Notes\n')).toBe(true)
        expect(result).toMatch(/_.*5m 12s_/)
    })

    it('renders bold speaker headers and inline-code timestamps', () => {
        const result = generateMarkdown(params)
        expect(result).toContain('**Speaker 1**')
        expect(result).toContain('**Speaker 2**')
        expect(result).toContain('`[0:00]` Hello everyone, thanks for joining.')
        expect(result).toContain('`[0:12]` Happy to be here.')
    })

    it('normalizes multi-line segment text so no body line injects block syntax', () => {
        const result = generateMarkdown({
            ...params,
            segments: [{ speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'Intro.\n# Not a heading' }],
        })
        expect(result).toContain('`[0:00]` Intro. # Not a heading')
        // The injected '#' must not start its own line.
        expect(result).not.toMatch(/\n# Not a heading/)
    })

    it('escapes backticks so a stray backtick cannot swallow a later timestamp', () => {
        const result = generateMarkdown({
            ...params,
            speakers: speakersOf(new Map([['s1', 'Speaker 1']])),
            segments: [
                { speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'I said `hello' },
                { speaker_id: 's1', start_ms: 8000, end_ms: 9000, text: 'world` and left' },
            ],
        })
        // Body backticks are escaped, leaving the timestamp backticks as the only
        // live ones, so each `[m:ss]` stays an intact, self-contained code span
        // instead of pairing across segment lines.
        expect(result).toContain('I said \\`hello')
        expect(result).toContain('world\\` and left')
        expect(result).toContain('`[0:00]`')
        expect(result).toContain('`[0:08]`')
    })

    it('escapes inline emphasis and link metacharacters in segment bodies', () => {
        const result = generateMarkdown({
            ...params,
            speakers: speakersOf(new Map([['s1', 'Speaker 1']])),
            segments: [
                { speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'use *bold* _under_ [link]' },
            ],
        })
        expect(result).toContain('use \\*bold\\* \\_under\\_ \\[link\\]')
    })

    it('escapes metacharacters in the title and speaker labels', () => {
        const result = generateMarkdown({
            ...params,
            transcriptTitle: 'Q3 *Review*',
            speakers: speakersOf(new Map([['s1', 'Speaker _1_']])),
            segments: [{ speaker_id: 's1', start_ms: 0, end_ms: 1000, text: 'hi' }],
        })
        expect(result).toContain('# Q3 \\*Review\\*')
        expect(result).toContain('**Speaker \\_1\\_**')
    })

    it('emits only title and metadata for empty segments', () => {
        const result = generateMarkdown({ ...params, segments: [] })
        expect(result).not.toContain('**')
        expect(result.startsWith('# Meeting Notes\n')).toBe(true)
    })

    it('heads an unassigned turn Unknown speaker', () => {
        const result = generateMarkdown({
            ...params,
            segments: [{ speaker_id: null, start_ms: 0, end_ms: 1000, text: 'Anon.' }],
        })
        expect(result).toContain('**Unknown speaker**')
    })
})
