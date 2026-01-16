/**
 * Consolidation Service for Inngest
 * 
 * Bridges the consolidation algorithm with Supabase database operations.
 * Fetches segments/words, runs consolidation, saves chunks/chunk_words.
 * 
 * Used by handleTranscriptionWebhook after storing Deepgram results.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
    consolidateAndProcess,
    SegmentData,
    ProcessedChunk,
    DEFAULT_CONFIG,
} from "@/lib/consolidation";

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

    // Fetch segments ordered by start time
    const { data: segments, error: segError } = await supabase
        .from("segments")
        .select("id, speaker_id, start_ms, end_ms, text")
        .eq("project_id", projectId)
        .order("start_ms", { ascending: true });

    if (segError) {
        throw new Error(`Failed to fetch segments: ${segError.message}`);
    }

    if (!segments || segments.length === 0) {
        return [];
    }

    // Fetch words in batches to avoid URL length limits with many segment IDs
    // (560 segments with UUID strings can exceed query limits)
    const segmentIds = segments.map((s: SegmentRow) => s.id);
    const batchSize = 50;
    const allWords: WordRow[] = [];

    console.log(`[consolidation] Fetching words for ${segmentIds.length} segments in batches of ${batchSize}`);

    for (let i = 0; i < segmentIds.length; i += batchSize) {
        const batch = segmentIds.slice(i, i + batchSize);
        const { data: batchWords, error: batchError } = await supabase
            .from("words")
            .select("id, segment_id")
            .in("segment_id", batch)
            .order("order_index", { ascending: true });

        if (batchError) {
            throw new Error(`Failed to fetch words batch ${Math.floor(i / batchSize) + 1}: ${batchError.message}`);
        }
        if (batchWords) {
            allWords.push(...(batchWords as WordRow[]));
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
    let totalChunkWords = 0;

    // Clear existing chunks for idempotency (cascade deletes chunk_words)
    const { error: deleteError } = await supabase
        .from("chunks")
        .delete()
        .eq("project_id", projectId);

    if (deleteError) {
        throw new Error(`Failed to clear chunks: ${deleteError.message}`);
    }

    // Insert chunks one by one to get IDs for chunk_words
    for (const chunk of chunks) {
        const { data: insertedChunk, error: chunkError } = await supabase
            .from("chunks")
            .insert({
                project_id: projectId,
                speaker_id: chunk.speakerId,
                start_ms: chunk.startMs,
                end_ms: chunk.endMs,
                text: chunk.text,
                source_segment_ids: chunk.sourceSegmentIds,
                is_edited: false,
                is_filler: chunk.isFiller,
                algo_version: chunk.algoVersion,
            })
            .select("id")
            .single();

        if (chunkError || !insertedChunk) {
            throw new Error(`Failed to insert chunk: ${chunkError?.message}`);
        }

        // Insert chunk_words junction records
        if (chunk.wordIds.length > 0) {
            const chunkWordRows = chunk.wordIds.map((wordId, index) => ({
                chunk_id: insertedChunk.id,
                word_id: wordId,
                order_index: index,
            }));

            const { error: cwError } = await supabase
                .from("chunk_words")
                .insert(chunkWordRows);

            if (cwError) {
                throw new Error(`Failed to insert chunk_words: ${cwError.message}`);
            }

            totalChunkWords += chunkWordRows.length;
        }
    }

    return totalChunkWords;
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
