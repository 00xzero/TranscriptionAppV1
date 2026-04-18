/**
 * Transcript Consolidation Algorithm
 *
 * TypeScript port of backend/app/services/consolidation.py
 * Merges fragmented transcription segments into larger, readable chunks.
 *
 * Key features:
 * - Time-gap and duration guardrails
 * - Speaker boundary enforcement
 * - Filler detection ("K.", "yeah", etc.)
 * - Sentence boundary awareness
 */

import {
    getWordCount,
    isFiller,
    isSentenceBoundary,
    normalizeText,
} from "@/core/transcript/text-utils";

// ============================================================================
// Configuration
// ============================================================================

export interface ConsolidationConfig {
    /** Soft target for words per chunk (triggers break at sentence boundary) */
    targetWords: number;
    /** Hard break if pause between segments exceeds this (milliseconds) */
    maxGapMs: number;
    /** Hard cap on chunk duration (milliseconds) */
    maxDurationMs: number;
    /** Fragments with <= this many words get absorbed into adjacent chunks */
    minAbsorbWords: number;
    /** Patterns to tag as filler (case-insensitive) */
    fillerPatterns: string[];
    /** Algorithm version for lineage tracking */
    algoVersion: string;
}

export const DEFAULT_CONFIG: ConsolidationConfig = {
    targetWords: 60,
    maxGapMs: 2000,
    maxDurationMs: 15000,
    minAbsorbWords: 3,
    fillerPatterns: [
        "k.", "okay.", "ok.", "yeah.", "yes.", "no.", "mm.", "mhmm.",
        "uh.", "um.", "hmm.", "right.", "sure.", "so.", "well.",
        "yep.", "nope.", "oh.", "ah.", "alright.",
    ],
    algoVersion: "v1.3-ts",
};

// ============================================================================
// Data Structures
// ============================================================================

export interface SegmentData {
    id: string;
    speakerId: string | null;
    startMs: number;
    endMs: number;
    text: string;
    wordIds: string[];
}

export interface ChunkData {
    speakerId: string | null;
    startMs: number;
    endMs: number;
    texts: string[];
    sourceSegmentIds: string[];
    wordIds: string[];
}

export function getChunkText(chunk: ChunkData): string {
    return chunk.texts.join(" ");
}

export function getChunkWordCount(chunk: ChunkData): number {
    return getWordCount(getChunkText(chunk));
}

export function getChunkDurationMs(chunk: ChunkData): number {
    return chunk.endMs - chunk.startMs;
}

// ============================================================================
// Core Algorithm Helpers
// ============================================================================

// ============================================================================
// Core Consolidation Algorithm
// ============================================================================

/**
 * Merge a segment into an existing chunk.
 */
function mergeSegmentIntoChunk(chunk: ChunkData, segment: SegmentData): void {
    chunk.texts.push(segment.text.trim());
    chunk.sourceSegmentIds.push(segment.id);
    chunk.wordIds.push(...segment.wordIds);
    chunk.endMs = segment.endMs;
}

/**
 * Create a new chunk from a segment.
 */
function createChunkFromSegment(segment: SegmentData): ChunkData {
    return {
        speakerId: segment.speakerId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        texts: [segment.text.trim()],
        sourceSegmentIds: [segment.id],
        wordIds: [...segment.wordIds],
    };
}

/**
 * Main consolidation algorithm.
 *
 * Groups segments by speaker and merges adjacent segments into chunks
 * based on timing, duration, and sentence boundaries.
 *
 * @param segments - List of segment data, should be pre-sorted by startMs
 * @param config - Consolidation parameters
 * @returns List of consolidated chunks
 */
export function consolidateSegments(
    segments: SegmentData[],
    config: ConsolidationConfig = DEFAULT_CONFIG
): ChunkData[] {
    if (segments.length === 0) {
        return [];
    }

    // Sort by start time (should already be sorted, but be safe)
    const sortedSegments = [...segments].sort((a, b) => a.startMs - b.startMs);

    const chunks: ChunkData[] = [];
    let currentChunk: ChunkData | null = null;

    for (const segment of sortedSegments) {
        // Start first chunk
        if (currentChunk === null) {
            currentChunk = createChunkFromSegment(segment);
            continue;
        }

        // Calculate gap from previous segment
        const gapMs = segment.startMs - currentChunk.endMs;

        // Check for speaker change
        const speakerChanged = segment.speakerId !== currentChunk.speakerId;

        // Calculate projected duration if we were to merge this segment
        // Use the actual time span (segment.endMs - currentChunk.startMs) not sum of individual durations
        const projectedDurationMs = segment.endMs - currentChunk.startMs;

        // Check hard break conditions
        const shouldBreak = (
            speakerChanged ||
            gapMs > config.maxGapMs ||
            projectedDurationMs > config.maxDurationMs
        );

        // Check soft break conditions (word count + sentence boundary)
        const chunkWordCount = getChunkWordCount(currentChunk);
        const chunkText = getChunkText(currentChunk);
        const softBreak = (
            chunkWordCount >= config.targetWords &&
            isSentenceBoundary(chunkText)
        );

        if (shouldBreak || softBreak) {
            // Finalize current chunk and start new one
            chunks.push(currentChunk);
            currentChunk = createChunkFromSegment(segment);
        } else {
            // Merge into current chunk
            mergeSegmentIntoChunk(currentChunk, segment);
        }
    }

    // Don't forget the last chunk
    if (currentChunk !== null) {
        chunks.push(currentChunk);
    }

    return chunks;
}

// ============================================================================
// Output Formatting
// ============================================================================

export interface ProcessedChunk {
    speakerId: string | null;
    startMs: number;
    endMs: number;
    text: string;
    sourceSegmentIds: string[];
    wordIds: string[];
    isFiller: boolean;
    algoVersion: string;
}

/**
 * Process raw chunk data into final output format with filler detection.
 */
export function processChunks(
    chunks: ChunkData[],
    config: ConsolidationConfig = DEFAULT_CONFIG
): ProcessedChunk[] {
    return chunks.map(chunk => {
        const normalizedText = normalizeText(chunk.texts);
        const wordCount = getWordCount(normalizedText);

        const chunkIsFiller = (
            wordCount <= config.minAbsorbWords &&
            isFiller(normalizedText, config.fillerPatterns)
        );

        return {
            speakerId: chunk.speakerId,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            text: normalizedText,
            sourceSegmentIds: chunk.sourceSegmentIds,
            wordIds: chunk.wordIds,
            isFiller: chunkIsFiller,
            algoVersion: config.algoVersion,
        };
    });
}

/**
 * Main entry point: consolidate and process segments.
 */
export function consolidateAndProcess(
    segments: SegmentData[],
    config: ConsolidationConfig = DEFAULT_CONFIG
): ProcessedChunk[] {
    const rawChunks = consolidateSegments(segments, config);
    return processChunks(rawChunks, config);
}

export {
    getWordCount,
    isFiller,
    isSentenceBoundary,
    normalizeText,
};
