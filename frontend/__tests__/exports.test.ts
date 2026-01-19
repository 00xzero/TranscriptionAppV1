/**
 * Unit tests for export utilities.
 *
 * Tests ported from backend/tests/test_exports.py
 * Run with: npm test -- --testPathPattern=exports
 */
import {
    formatDuration,
    msToTimestamp,
    msToVttTimestamp,
    normalizeFilename,
    generateVtt,
} from '../lib/exports'

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
})

describe('generateVtt', () => {
    const sampleChunks = [
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

    const sampleSpeakers = {
        s1: { label: 'Speaker One' },
        s2: { label: 'Speaker Two' },
    }

    it('returns a string', () => {
        const result = generateVtt({
            chunks: sampleChunks,
            speakersMap: sampleSpeakers,
            projectId: 'test-project',
        })
        expect(typeof result).toBe('string')
    })

    it('starts with WEBVTT header', () => {
        const result = generateVtt({
            chunks: sampleChunks,
            speakersMap: sampleSpeakers,
            projectId: 'test-project',
        })
        expect(result.startsWith('WEBVTT')).toBe(true)
    })

    it('contains speaker voice tags', () => {
        const result = generateVtt({
            chunks: sampleChunks,
            speakersMap: sampleSpeakers,
            projectId: 'test-project',
        })
        expect(result).toContain('<v Speaker One>')
        expect(result).toContain('<v Speaker Two>')
    })

    it('contains cue identifiers', () => {
        const result = generateVtt({
            chunks: sampleChunks,
            speakersMap: sampleSpeakers,
            projectId: 'test-project',
        })
        expect(result).toContain('test-project/0')
        expect(result).toContain('test-project/1')
    })

    it('contains properly formatted timestamps', () => {
        const result = generateVtt({
            chunks: sampleChunks,
            speakersMap: sampleSpeakers,
            projectId: 'test-project',
        })
        expect(result).toContain('00:00:04.205 --> 00:00:10.243')
    })

    it('handles empty chunks array', () => {
        const result = generateVtt({
            chunks: [],
            speakersMap: {},
            projectId: 'test-project',
        })
        expect(result).toBe('WEBVTT\n')
    })
})
