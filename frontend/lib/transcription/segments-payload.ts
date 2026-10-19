/**
 * The segments payload `save_transcript_segments` stores, from any engine's
 * words: the canonical buildSegments pipeline, with ids made up front.
 */

import { randomUUID } from "crypto";

import {
    DEFAULT_SEGMENT_BUILDER_CONFIG,
    buildSegments,
} from "@/core/transcript/segment-builder";
import type { EngineWords } from "@/core/transcription/engines/types";
import type { SaveTranscriptSegmentsPayload } from "@/contracts/db";

/**
 * Build the SaveTranscriptSegmentsPayload from an engine's words.
 *
 * - Runs the canonical buildSegments pipeline on words any engine produced.
 * - Pre-generates a UUID per segment so the RPC can persist segments + words
 *   without a round-trip to discover inserted ids.
 * - Collects the engine's speaker numbers into a deduped `speakers` array — the
 *   RPC keys transcript speakers on them (diarization index) and resolves
 *   segment.speaker_id by joining on `speaker_num`. No labels are sent: a new
 *   speaker displays as `Speaker {ordinal}`.
 * - Falls back to a single empty segment holding the engine's plain text when
 *   it found no words.
 */
export function buildRpcPayload({ words, fallbackText }: EngineWords): SaveTranscriptSegmentsPayload {
    if (words.length === 0) {
        return {
            speakers: [],
            segments: [
                {
                    id: randomUUID(),
                    speaker_num: null,
                    start_ms: 0,
                    end_ms: 0,
                    text: fallbackText,
                    is_filler: false,
                    algo_version: DEFAULT_SEGMENT_BUILDER_CONFIG.algoVersion,
                    words: [],
                },
            ],
        };
    }

    const builtSegments = buildSegments(words, DEFAULT_SEGMENT_BUILDER_CONFIG);

    const speakerNums = new Set<number>();
    const segments = builtSegments.map((seg) => {
        if (typeof seg.speakerNum === "number") {
            speakerNums.add(seg.speakerNum);
        }

        return {
            id: randomUUID(),
            speaker_num: typeof seg.speakerNum === "number" ? seg.speakerNum : null,
            start_ms: seg.startMs,
            end_ms: seg.endMs,
            text: seg.text,
            is_filler: seg.isFiller,
            algo_version: seg.algoVersion,
            words: seg.words.map((w, idx) => ({
                start_ms: w.startMs,
                end_ms: w.endMs,
                text: w.text,
                confidence: w.confidence,
                order_index: idx,
                speaker: w.speaker,
                speaker_confidence: w.speakerConfidence,
                punctuated_text: w.punctuatedText,
                paragraph_index: w.paragraphIndex,
                sentence_end: w.sentenceEnd,
            })),
        };
    });

    const speakers = Array.from(speakerNums)
        .sort((a, b) => a - b)
        .map((num) => ({ num }));

    return { speakers, segments };
}
