/**
 * Handle a transcription engine's result
 * Triggered once an engine's callback has stored its result. Turns it into
 * words with the transcript's engine, builds segments and stores them.
 *
 * On failure (after retries exhausted), emits transcription/failed event
 * so the UI can surface the error to the user.
 */

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { downloadTranscriptionResult } from "@/infra/supabase/transcription-results.server";
import {
    SaveTranscriptSegmentsPayloadSchema,
    SaveTranscriptSegmentsResultSchema,
} from "@/contracts/db";
import { transcriptionWebhookTrigger } from "@/lib/inngest/events";
import { getEngine } from "@/lib/transcription/engines.server";
import { buildRpcPayload } from "@/lib/transcription/segments-payload";
import { writeTranscriptionFailureFallback } from "./_shared";

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
                await writeTranscriptionFailureFallback({
                    transcriptId,
                    jobId,
                    error: {
                        error_message: `Transcription failed: ${errorMessage.slice(0, 200)}`,
                        error_type: "transcription_error",
                        error_detail: errorMessage.slice(0, 500),
                    },
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

        // Step 2: Read the engine's result, build canonical transcript, and persist
        //         via a single atomic RPC call. The RPC replaces segments/words and
        //         creates missing speakers inside one Postgres transaction, so a mid-write
        //         failure cannot leave the transcript with partial data.
        const transcriptionResult = await step.run("store-transcription", async () => {
            const supabase = createAdminClient();

            // Load the engine's result (stored by its callback route)
            const { data: jobRow, error: jobRowError } = await supabase
                .from("jobs")
                .select("result_object_key")
                .eq("id", job.id)
                .single();

            if (jobRowError || !jobRow) {
                throw new Error(`Failed to load job: ${jobRowError?.message}`);
            }
            if (!jobRow.result_object_key) {
                throw new Error(`Job ${job.id} has no stored engine result`);
            }

            // The engine the transcript was made with reads its own result.
            const { data: transcriptRow, error: transcriptRowError } = await supabase
                .from("transcripts")
                .select("engine")
                .eq("id", transcriptId)
                .single();

            if (transcriptRowError || !transcriptRow) {
                throw new Error(`Failed to load transcript: ${transcriptRowError?.message}`);
            }

            const rawResponse = await downloadTranscriptionResult(supabase, jobRow.result_object_key);
            const engineWords = getEngine(transcriptRow.engine).resultToWords(rawResponse);

            // Build the canonical transcript in TypeScript. The RPC just persists it.
            const payload = buildRpcPayload(engineWords);

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
