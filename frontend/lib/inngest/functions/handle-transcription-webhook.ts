/**
 * Handle Deepgram webhook callback
 * Triggered when Deepgram completes transcription and sends results.
 * Parses utterances/words and stores in Supabase.
 *
 * On failure (after retries exhausted), emits transcription/failed event
 * so the UI can surface the error to the user.
 */

import { randomUUID } from "crypto";

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import {
    DEFAULT_SEGMENT_BUILDER_CONFIG,
    buildSegments,
    normalizeWords,
} from "@/core/transcript/segment-builder";
import { DeepgramWebhookPayloadSchema, type DeepgramWord } from "@/contracts/webhook";
import {
    SaveTranscriptSegmentsPayload,
    SaveTranscriptSegmentsPayloadSchema,
    SaveTranscriptSegmentsResultSchema,
} from "@/contracts/db";
import { transcriptionWebhookTrigger } from "@/lib/inngest/events";
import { writeTranscriptionFailureFallback } from "./_shared";

/**
 * Minimal alternative shape used to derive paragraphs + transcript fallback.
 * Extracted to keep buildRpcPayload signature precise and testable.
 */
type AlternativeForPayload = {
    transcript?: string;
    paragraphs?: { paragraphs: Array<{ speaker: number; start: number; end: number; sentences: Array<{ text: string; start: number; end: number }> }> };
} | undefined;

/**
 * Build the SaveTranscriptSegmentsPayload from raw Deepgram words.
 *
 * - Runs the canonical normalize → buildSegments pipeline (same as before).
 * - Pre-generates a UUID per segment so the RPC can persist segments + words
 *   without a round-trip to discover inserted ids.
 * - Collects unique speakers into a deduped `speakers` array — the RPC upserts
 *   these and resolves segment.speaker_id by joining on `speaker_num`.
 * - Falls back to a single empty segment when Deepgram returned no words,
 *   matching the pre-refactor behavior.
 */
function buildRpcPayload(
    rawWords: DeepgramWord[],
    alt: AlternativeForPayload,
): SaveTranscriptSegmentsPayload {
    if (rawWords.length === 0) {
        return {
            speakers: [],
            segments: [
                {
                    id: randomUUID(),
                    speaker_num: null,
                    start_ms: 0,
                    end_ms: 0,
                    text: alt?.transcript ?? "",
                    is_filler: false,
                    algo_version: DEFAULT_SEGMENT_BUILDER_CONFIG.algoVersion,
                    words: [],
                },
            ],
        };
    }

    const normalizedWords = normalizeWords(rawWords, alt?.paragraphs ?? null);
    const builtSegments = buildSegments(normalizedWords, DEFAULT_SEGMENT_BUILDER_CONFIG);

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
        .map((num) => ({ num, label: `Speaker ${num}` }));

    return { speakers, segments };
}

export const handleTranscriptionWebhook = inngest.createFunction(
    {
        id: "handle-transcription-webhook",
        triggers: [{ event: transcriptionWebhookTrigger }],
        retries: 3,
        // Limit to 1 concurrent execution per transcript so replayed or duplicate
        // webhook deliveries cannot interleave segment rewrites.
        concurrency: {
            limit: 1,
            key: "event.data.transcriptId",
        },
        onFailure: async ({ event, error }) => {
            // When retries are exhausted, emit failure event so job/transcript get error status
            // In onFailure, original event is nested under event.data.event
            const originalEvent = event.data.event;
            const { transcriptId, requestId } = originalEvent.data;
            const errorMessage = error.message || String(error);

            console.error(`[inngest] Webhook handler failed for transcript ${transcriptId}:`, errorMessage);

            // Look up the job by requestId to get the real jobId
            let jobId: string | undefined;
            try {
                const supabase = createAdminClient();
                const { data: job } = await supabase
                    .from("jobs")
                    .select("id")
                    .eq("transcript_id", transcriptId)
                    .eq("inngest_event_id", requestId)
                    .single();

                if (job) {
                    jobId = job.id;
                }
            } catch (lookupError) {
                console.error("[inngest] Failed to lookup job in onFailure:", lookupError);
            }

            // Emit transcription/failed to update job/transcript status
            try {
                await sendInngestEvent({
                    name: "transcription/failed",
                    data: {
                        transcriptId,
                        ...(jobId ? { jobId } : {}),
                        error: errorMessage,
                        errorType: "transcription_error",
                    },
                });
            } catch (sendError) {
                console.error("[inngest] Failed to emit transcription/failed:", sendError);
                // Fallback: write error directly so the UI can surface it
                const payload = {
                    error: `Transcription failed: ${errorMessage.slice(0, 200)}`,
                    error_type: "transcription_error",
                    raw_error: errorMessage.slice(0, 500),
                };
                await writeTranscriptionFailureFallback({
                    transcriptId,
                    jobId,
                    payload,
                    context: "onFailure",
                });
            }
        },
    },
    async ({ event, step }) => {
        const { requestId, transcriptId } = event.data;

        console.log(`[inngest] Webhook received for transcript: ${transcriptId}, request: ${requestId}`);

        // Step 1: Find the job for this transcript
        const job = await step.run("find-job", async () => {
            const supabase = createAdminClient();

            const { data, error } = await supabase
                .from("jobs")
                .select("id, status")
                .eq("transcript_id", transcriptId)
                .eq("inngest_event_id", requestId)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();

            if (error || !data) {
                console.error("[inngest] Job not found for transcript:", transcriptId, "requestId:", requestId);
                throw new Error(`Job not found for transcript: ${transcriptId}, requestId: ${requestId}`);
            }

            return data;
        });

        // Guard against late replays — job already completed means segments are final
        if (job.status === "completed") {
            console.log(`[inngest] Job ${job.id} already completed — skipping replay for transcript ${transcriptId}`);
            return { status: "skipped", transcriptId, jobId: job.id };
        }

        // Step 2: Parse Deepgram payload, build canonical transcript, and persist
        //         via a single atomic RPC call. The RPC replaces segments/words/
        //         speaker upserts inside one Postgres transaction, so a mid-write
        //         failure cannot leave the transcript with partial data.
        const transcriptionResult = await step.run("store-transcription", async () => {
            const supabase = createAdminClient();

            // Load Deepgram payload (stored by webhook route)
            const { data: jobRow, error: jobRowError } = await supabase
                .from("jobs")
                .select("payload")
                .eq("id", job.id)
                .single();

            if (jobRowError || !jobRow) {
                throw new Error(`Failed to load job payload: ${jobRowError?.message}`);
            }

            const jobPayload = (jobRow as { payload: Record<string, unknown> | null }).payload;
            const responseParsed = DeepgramWebhookPayloadSchema.safeParse(jobPayload?.deepgram);
            if (!responseParsed.success) {
                throw new Error(`Invalid Deepgram payload structure: ${responseParsed.error.issues[0]?.message ?? 'Invalid input'}`);
            }
            const response = responseParsed.data;

            // Parse Deepgram response — use channel words for word-level speaker grouping
            const results = response.results || {};
            const channels = results.channels || [];
            const alt = channels[0]?.alternatives?.[0];
            const words = alt?.words || [];

            // Build the canonical transcript in TypeScript. The RPC just persists it.
            const payload = buildRpcPayload(words, alt);

            // Defence-in-depth: validate the payload we're about to send.
            const validatedPayload = SaveTranscriptSegmentsPayloadSchema.parse(payload);

            const { data: rpcData, error: rpcError } = await supabase.rpc(
                "save_transcript_segments",
                {
                    p_transcript_id: transcriptId,
                    p_payload: validatedPayload,
                }
            );

            if (rpcError) {
                throw new Error(`save_transcript_segments RPC failed: ${rpcError.message}`);
            }

            const summary = SaveTranscriptSegmentsResultSchema.parse(rpcData);

            return {
                segmentCount: summary.segment_count,
                wordCount: summary.word_count,
                durationMs: summary.duration_ms,
            };
        });

        // Step 3: Trigger completion event
        console.log(`[inngest] Sending transcription/completed event for transcript: ${transcriptId}`);
        await step.sendEvent("trigger-completed", {
            name: "transcription/completed",
            data: {
                transcriptId,
                jobId: job.id,
                duration: Math.floor(transcriptionResult.durationMs / 1000),
            },
        });
        console.log(`[inngest] transcription/completed event sent successfully for transcript: ${transcriptId}`);

        console.log(
            `[inngest] Transcription stored: ${transcriptionResult.segmentCount} segments, ` +
            `${transcriptionResult.wordCount} words, ${transcriptionResult.durationMs}ms duration`
        );
        return {
            status: "stored",
            transcriptId,
            jobId: job.id,
            ...transcriptionResult,
        };
    }
);
