/**
 * Tests for Transcript Consolidation Algorithm
 * 
 * Validates the TypeScript port against expected behavior:
 * - Empty input handling
 * - Speaker change breaks
 * - Gap-based breaks
 * - Duration-based breaks  
 * - Sentence boundary soft breaks
 * - Filler detection
 * - Text normalization
 */

import {
    consolidateSegments,
    consolidateAndProcess,
    isSentenceBoundary,
    isFiller,
    normalizeText,
    getWordCount,
    DEFAULT_CONFIG,
    type SegmentData,
    type ConsolidationConfig,
} from '../lib/consolidation';

// ============================================================================
// Helper Functions
// ============================================================================

function createSegment(
    id: string,
    speakerId: string | null,
    startMs: number,
    endMs: number,
    text: string
): SegmentData {
    return { id, speakerId, startMs, endMs, text, wordIds: [] };
}

// ============================================================================
// Unit Tests: Helper Functions
// ============================================================================

describe('isSentenceBoundary', () => {
    it('should detect period as sentence boundary', () => {
        expect(isSentenceBoundary('Hello world.')).toBe(true);
    });

    it('should detect question mark as sentence boundary', () => {
        expect(isSentenceBoundary('How are you?')).toBe(true);
    });

    it('should detect exclamation as sentence boundary', () => {
        expect(isSentenceBoundary('Wow!')).toBe(true);
    });

    it('should detect quote as sentence boundary', () => {
        expect(isSentenceBoundary('He said "hello"')).toBe(true);
    });

    it('should not detect mid-sentence as boundary', () => {
        expect(isSentenceBoundary('Hello world')).toBe(false);
        expect(isSentenceBoundary('Hello,')).toBe(false);
    });

    it('should handle trailing whitespace', () => {
        expect(isSentenceBoundary('Hello world.   ')).toBe(true);
    });
});

describe('isFiller', () => {
    const patterns = DEFAULT_CONFIG.fillerPatterns;

    it('should detect exact filler matches', () => {
        expect(isFiller('yeah.', patterns)).toBe(true);
        expect(isFiller('ok.', patterns)).toBe(true);
        expect(isFiller('mhmm.', patterns)).toBe(true);
    });

    it('should detect fillers without period', () => {
        expect(isFiller('yeah', patterns)).toBe(true);
        expect(isFiller('ok', patterns)).toBe(true);
    });

    it('should be case-insensitive', () => {
        expect(isFiller('Yeah.', patterns)).toBe(true);
        expect(isFiller('OKAY.', patterns)).toBe(true);
    });

    it('should not match non-fillers', () => {
        expect(isFiller('Hello there.', patterns)).toBe(false);
        expect(isFiller('absolutely', patterns)).toBe(false);
    });

    it('should handle whitespace', () => {
        expect(isFiller('  yeah  ', patterns)).toBe(true);
    });
});

describe('normalizeText', () => {
    it('should join texts with single space', () => {
        expect(normalizeText(['Hello', 'world'])).toBe('Hello world');
    });

    it('should fix double spaces', () => {
        expect(normalizeText(['Hello  ', '  world'])).toBe('Hello world');
    });

    it('should add space after punctuation followed by letter', () => {
        expect(normalizeText(['Hello.World'])).toBe('Hello. World');
    });

    it('should filter empty strings', () => {
        expect(normalizeText(['Hello', '', 'world', '  '])).toBe('Hello world');
    });

    it('should trim result', () => {
        expect(normalizeText(['  Hello  ', '  world  '])).toBe('Hello world');
    });
});

describe('getWordCount', () => {
    it('should count words correctly', () => {
        expect(getWordCount('Hello world')).toBe(2);
        expect(getWordCount('One two three four')).toBe(4);
    });

    it('should handle multiple spaces', () => {
        expect(getWordCount('Hello    world')).toBe(2);
    });

    it('should handle empty string', () => {
        expect(getWordCount('')).toBe(0);
        expect(getWordCount('   ')).toBe(0);
    });
});

// ============================================================================
// Integration Tests: consolidateSegments
// ============================================================================

describe('consolidateSegments', () => {
    describe('basic cases', () => {
        it('should return empty array for empty input', () => {
            expect(consolidateSegments([])).toEqual([]);
        });

        it('should create single chunk for single segment', () => {
            const segments = [createSegment('1', 'speaker-1', 0, 1000, 'Hello world.')];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(1);
            expect(chunks[0].speakerId).toBe('speaker-1');
            expect(chunks[0].startMs).toBe(0);
            expect(chunks[0].endMs).toBe(1000);
            expect(chunks[0].sourceSegmentIds).toEqual(['1']);
        });

        it('should merge adjacent segments from same speaker', () => {
            const segments = [
                createSegment('1', 'speaker-1', 0, 1000, 'Hello'),
                createSegment('2', 'speaker-1', 1000, 2000, 'world'),
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(1);
            expect(chunks[0].texts).toEqual(['Hello', 'world']);
            expect(chunks[0].sourceSegmentIds).toEqual(['1', '2']);
        });
    });

    describe('speaker change breaks', () => {
        it('should break on speaker change', () => {
            const segments = [
                createSegment('1', 'speaker-1', 0, 1000, 'Hello'),
                createSegment('2', 'speaker-2', 1000, 2000, 'Hi there'),
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(2);
            expect(chunks[0].speakerId).toBe('speaker-1');
            expect(chunks[1].speakerId).toBe('speaker-2');
        });

        it('should handle null speaker transitions', () => {
            const segments = [
                createSegment('1', null, 0, 1000, 'Unknown'),
                createSegment('2', 'speaker-1', 1000, 2000, 'Known'),
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(2);
        });
    });

    describe('gap-based breaks', () => {
        it('should break on gap > maxGapMs', () => {
            const segments = [
                createSegment('1', 'speaker-1', 0, 1000, 'First'),
                createSegment('2', 'speaker-1', 4000, 5000, 'Second'),  // 3000ms gap
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(2);
        });

        it('should not break on gap <= maxGapMs', () => {
            const segments = [
                createSegment('1', 'speaker-1', 0, 1000, 'First'),
                createSegment('2', 'speaker-1', 2500, 3500, 'Second'),  // 1500ms gap
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(1);
        });
    });

    describe('duration-based breaks', () => {
        it('should break when duration would exceed maxDurationMs', () => {
            const segments = [
                createSegment('1', 'speaker-1', 0, 10000, 'First long segment'),
                createSegment('2', 'speaker-1', 10000, 18000, 'Second long segment'),  // Total would be 18s
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(2);
        });
    });

    describe('soft breaks (word count + sentence boundary)', () => {
        it('should break at sentence boundary when word count exceeded', () => {
            // Create a segment with 65 words ending in period
            const longText = Array(65).fill('word').join(' ') + '.';
            const segments = [
                createSegment('1', 'speaker-1', 0, 5000, longText),
                createSegment('2', 'speaker-1', 5000, 6000, 'Next segment'),
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(2);
        });

        it('should not break if no sentence boundary', () => {
            // Create a segment with 65 words NOT ending in period
            const longText = Array(65).fill('word').join(' ');
            const segments = [
                createSegment('1', 'speaker-1', 0, 5000, longText),
                createSegment('2', 'speaker-1', 5000, 6000, 'Next'),
            ];
            const chunks = consolidateSegments(segments);

            // Should merge because no sentence boundary
            expect(chunks).toHaveLength(1);
        });
    });

    describe('sorting', () => {
        it('should sort segments by startMs', () => {
            const segments = [
                createSegment('2', 'speaker-1', 1000, 2000, 'Second'),
                createSegment('1', 'speaker-1', 0, 1000, 'First'),  // Out of order
            ];
            const chunks = consolidateSegments(segments);

            expect(chunks).toHaveLength(1);
            expect(chunks[0].texts).toEqual(['First', 'Second']);
        });
    });
});

// ============================================================================
// Integration Tests: consolidateAndProcess
// ============================================================================

describe('consolidateAndProcess', () => {
    it('should normalize text in output', () => {
        const segments = [
            createSegment('1', 'speaker-1', 0, 1000, '  Hello  '),
            createSegment('2', 'speaker-1', 1000, 2000, '  world.  '),
        ];
        const chunks = consolidateAndProcess(segments);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toBe('Hello world.');
    });

    it('should detect filler chunks', () => {
        const segments = [
            createSegment('1', 'speaker-1', 0, 500, 'Yeah.'),
        ];
        const chunks = consolidateAndProcess(segments);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].isFiller).toBe(true);
    });

    it('should not mark non-filler as filler', () => {
        const segments = [
            createSegment('1', 'speaker-1', 0, 1000, 'Hello there, how are you doing today?'),
        ];
        const chunks = consolidateAndProcess(segments);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].isFiller).toBe(false);
    });

    it('should include algorithm version', () => {
        const segments = [createSegment('1', 'speaker-1', 0, 1000, 'Test')];
        const chunks = consolidateAndProcess(segments);

        expect(chunks[0].algoVersion).toBe('v1.3-ts');
    });

    it('should preserve source segment IDs', () => {
        const segments = [
            createSegment('seg-1', 'speaker-1', 0, 1000, 'First'),
            createSegment('seg-2', 'speaker-1', 1000, 2000, 'Second'),
        ];
        const chunks = consolidateAndProcess(segments);

        expect(chunks[0].sourceSegmentIds).toEqual(['seg-1', 'seg-2']);
    });
});

// ============================================================================
// Custom Config Tests
// ============================================================================

describe('custom configuration', () => {
    it('should respect custom targetWords', () => {
        const config: ConsolidationConfig = {
            ...DEFAULT_CONFIG,
            targetWords: 3,
        };

        const segments = [
            createSegment('1', 'speaker-1', 0, 1000, 'One two three.'),
            createSegment('2', 'speaker-1', 1000, 2000, 'Four five'),
        ];

        const chunks = consolidateSegments(segments, config);
        expect(chunks).toHaveLength(2);
    });

    it('should respect custom maxGapMs', () => {
        const config: ConsolidationConfig = {
            ...DEFAULT_CONFIG,
            maxGapMs: 500,  // Very short gap tolerance
        };

        const segments = [
            createSegment('1', 'speaker-1', 0, 1000, 'First'),
            createSegment('2', 'speaker-1', 2000, 3000, 'Second'),  // 1000ms gap
        ];

        const chunks = consolidateSegments(segments, config);
        expect(chunks).toHaveLength(2);
    });

    it('should respect custom maxDurationMs', () => {
        const config: ConsolidationConfig = {
            ...DEFAULT_CONFIG,
            maxDurationMs: 3000,  // Very short duration limit
        };

        const segments = [
            createSegment('1', 'speaker-1', 0, 2000, 'First'),
            createSegment('2', 'speaker-1', 2000, 4000, 'Second'),  // Total would be 4s
        ];

        const chunks = consolidateSegments(segments, config);
        expect(chunks).toHaveLength(2);
    });
});
