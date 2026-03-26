/**
 * Consolidation Service for Inngest
 *
 * Bridges the consolidation algorithm with Supabase database operations.
 * Fetches segments/words, runs consolidation, saves chunks/chunk_words.
 *
 * Used by handleTranscriptionWebhook after storing Deepgram results.
 */

import { createAdminClient } from "@/infra/supabase/admin";
import {
    consolidateAndProcess,
    SegmentData,
    ProcessedChunk,
    DEFAULT_CONFIG,
} from "@/core/transcript/consolidation";

// ============================================================================
// Types
// ============================================================================

export interface ConsolidationResult {
    chunkCount: number;
    chunkWordCount: number;
    algoVersion: string;
}

interface SegmentRow {
    id: string;
    speaker_id: string | null;
    start_ms: number;
    end_ms: number;
    text: string;
}

interface WordRow {
    id: string;
    segment_id: string;
}

// ============================================================================
// Fetch Segments with Word IDs
// ============================================================================

/**
 * Fetch segments with their word IDs for consolidation.
 * Uses batched fetching to avoid URL length limits with large segment counts.
 *
 * @param projectId - Project UUID
 * @returns Array of SegmentData ready for consolidation
 */
async function fetchSegmentsWithWords(projectId: string): Promise<SegmentData[]> {
    const supabase = createAdminClient();

    // Fetch segments ordered by start time, paginated to avoid PostgREST's
    // default 1000-row limit which silently truncates large result sets.
    const PAGE_SIZE = 1000;
    const segments: SegmentRow[] = [];
    let offset = 0;

    while (true) {
        const { data: page, error: segError } = await supabase
            .from("segments")
            .select("id, speaker_id, start_ms, end_ms, text")
            .eq("project_id", projectId)
            .order("start_ms", { ascending: true })
            .order("id", { ascending: true }) // tie-breaker for deterministic pagination
            .range(offset, offset + PAGE_SIZE - 1);

        if (segError) {
            throw new Error(`Failed to fetch segments: ${segError.message}`);
        }

        if (!page || page.length === 0) break;
        segments.push(...(page as SegmentRow[]));
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    if (segments.length === 0) {
        return [];
    }

    // Fetch words in batches to avoid URL length limits with many segment IDs
    // (560 segments with UUID strings can exceed query limits)
    const segmentIds = segments.map((s: SegmentRow) => s.id);
    const batchSize = 50;
    const WORD_PAGE_SIZE = 1000;
    const allWords: WordRow[] = [];

    console.log(`[consolidation] Fetching words for ${segmentIds.length} segments in batches of ${batchSize}`);

    for (let i = 0; i < segmentIds.length; i += batchSize) {
        const batch = segmentIds.slice(i, i + batchSize);
        let wordOffset = 0;

        while (true) {
            const { data: pageWords, error: pageError } = await supabase
                .from("words")
                .select("id, segment_id")
                .in("segment_id", batch)
                .order("order_index", { ascending: true })
                .order("id", { ascending: true })  // tie-breaker for deterministic pagination
                .range(wordOffset, wordOffset + WORD_PAGE_SIZE - 1);

            if (pageError) {
                throw new Error(
                    `Failed to fetch words batch ${Math.floor(i / batchSize) + 1}: ${pageError.message}`
                );
            }
            if (!pageWords || pageWords.length === 0) {
                break;
            }

            allWords.push(...(pageWords as WordRow[]));

            if (pageWords.length < WORD_PAGE_SIZE) {
                break;
            }
            wordOffset += WORD_PAGE_SIZE;
        }
    }

    console.log(`[consolidation] Fetched ${allWords.length} words total`);

    // Group word IDs by segment ID
    const wordsBySegment: Record<string, string[]> = {};
    for (const word of allWords) {
        if (!wordsBySegment[word.segment_id]) {
            wordsBySegment[word.segment_id] = [];
        }
        wordsBySegment[word.segment_id].push(word.id);
    }

    // Transform to SegmentData format
    return segments.map((seg: SegmentRow) => ({
        id: seg.id,
        speakerId: seg.speaker_id,
        startMs: seg.start_ms,
        endMs: seg.end_ms,
        text: seg.text,
        wordIds: wordsBySegment[seg.id] || [],
    }));
}

// ============================================================================
// Save Chunks and Chunk Words
// ============================================================================

/**
 * Save processed chunks and their word mappings to Supabase.
 * Uses a transactional RPC function to ensure atomicity.
 *
 * @param projectId - Project UUID
 * @param chunks - Processed chunks from consolidation
 * @returns Number of chunk_words inserted
 */
async function saveChunks(
    projectId: string,
    chunks: ProcessedChunk[]
): Promise<number> {
    const supabase = createAdminClient();

    // Transform chunks to JSON format expected by RPC
    const chunksPayload = chunks.map(chunk => ({
        speakerId: chunk.speakerId,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        text: chunk.text,
        sourceSegmentIds: chunk.sourceSegmentIds,
        isFiller: chunk.isFiller,
        algoVersion: chunk.algoVersion,
        wordIds: chunk.wordIds,
    }));

    // Call transactional RPC function for atomic delete + insert
    const { data, error } = await supabase.rpc("save_consolidated_chunks", {
        p_project_id: projectId,
        p_chunks: chunksPayload,
    });

    if (error) {
        throw new Error(`Failed to save chunks: ${error.message}`);
    }

    // RPC returns array with single row containing counts
    const result = data?.[0];
    if (!result) {
        throw new Error("save_consolidated_chunks returned no result");
    }

    return result.chunk_word_count;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Run consolidation pipeline for a project.
 *
 * Fetches segments and words, runs consolidation algorithm,
 * saves chunks and chunk_words to Supabase.
 *
 * @param projectId - Project UUID
 * @returns Consolidation statistics
 */
export async function runConsolidation(
    projectId: string
): Promise<ConsolidationResult> {
    console.log(`[consolidation] Starting consolidation for project: ${projectId}`);

    // Step 1: Fetch segments with word IDs
    const segments = await fetchSegmentsWithWords(projectId);

    if (segments.length === 0) {
        console.log(`[consolidation] No segments to consolidate for project: ${projectId}`);
        return {
            chunkCount: 0,
            chunkWordCount: 0,
            algoVersion: DEFAULT_CONFIG.algoVersion,
        };
    }

    console.log(`[consolidation] Fetched ${segments.length} segments`);

    // Step 2: Run consolidation algorithm
    const processedChunks = consolidateAndProcess(segments, DEFAULT_CONFIG);

    console.log(`[consolidation] Generated ${processedChunks.length} chunks`);

    // Step 3: Save to database
    const chunkWordCount = await saveChunks(projectId, processedChunks);

    console.log(
        `[consolidation] Saved ${processedChunks.length} chunks, ` +
        `${chunkWordCount} chunk_words for project: ${projectId}`
    );

    return {
        chunkCount: processedChunks.length,
        chunkWordCount,
        algoVersion: DEFAULT_CONFIG.algoVersion,
    };
}
