/**
 * The contract every transcription engine meets. The pipeline only ever talks
 * to an engine through it: lib/transcription/engines.server.ts maps an engine
 * name to its implementation.
 */

import type { TranscriptionEngine as EngineId, TranscriptionOptions } from "@/contracts/transcription-options";
import type { NormalizedWord } from "@/core/transcript/segment-builder";

export interface EngineStartInput {
    /** A URL the engine can fetch the media from. */
    mediaUrl: string;
    transcriptId: string;
    /** The job attempt; an engine whose callback can carry it names it there. */
    jobId: string;
    /** The transcript's owner, whose folder holds the result; carried like jobId. */
    userId: string;
    keyTerms?: string[];
    options: TranscriptionOptions;
}

/** The engine's id for the job, which its callback names again. */
export type EngineStartResult =
    | { requestId: string; error: null }
    | { requestId: null; error: string };

/**
 * A stored engine result as our words. `fallbackText` is the engine's plain
 * transcript, kept when it found no words so the transcript is not blank.
 */
export interface EngineWords {
    words: NormalizedWord[];
    fallbackText: string;
}

export interface TranscriptionEngine {
    id: EngineId;
    /** Ask the engine to transcribe; it calls back on its own route when done. */
    start(input: EngineStartInput): Promise<EngineStartResult>;
    /** The stored result file, exactly as the engine sent it, as our words. */
    resultToWords(rawJson: string): EngineWords;
}
