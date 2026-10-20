/**
 * Handle transcription request
 * Triggered when user starts a new transcription job.
 * Starts the job with the transcript's engine and stores its request_id.
 *
 * On failure (e.g., the engine's API rejects it), emits transcription/failed
 * so job/transcript status is updated and users see the error.
 */

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { transitionJob } from "@/core/transcription/transition";
import { classifyError } from "@/core/transcription/errors";
import { getMediaUrlForEngine } from "@/infra/supabase/storage";
import { transcriptionRequestedTrigger } from "@/lib/inngest/events";
import { jobQueued } from "@/lib/inngest/job-checks";
import { ownedSourceKey, readSourceRow } from "@/lib/media/source-row";
import { readPositiveIntEnv } from "@/lib/env";
import { resolveTranscriptionOptions } from "@/contracts/transcription-options";
import { getEngine } from "@/lib/transcription/engines.server";
import { writeTranscriptionFailureFallback } from "./_shared";

// Configurable concurrency limit for engine API calls
const DEEPGRAM_CONCURRENCY = readPositiveIntEnv("DEEPGRAM_CONCURRENCY_LIMIT", 5);

export const handleTranscriptionRequested = inngest.createFunction(
    {
        id: "handle-transcription-requested",
        triggers: [{ event: transcriptionRequestedTrigger }],
        concurrency: {
            scope: "account",
            // One queue for every engine, named for the first one. It limits
            // only the short start call, so sharing costs little, and a fixed
            // key needs nothing from the event (the scheduler reads this
            // expression, not resolveTranscriptionOptions).
            key: '"deepgram"',
            limit: DEEPGRAM_CONCURRENCY,
        },
        retries: 2,
        onFailure: async ({ event, error }) => {
            // When retries are exhausted, emit failure event
            const originalEvent = event.data.event;
            const { transcriptId, jobId } = originalEvent.data;
            const errorMessage = error.message || String(error);

            console.error(`[inngest] Transcription request failed for transcript ${transcriptId}:`, errorMessage);

            // Classify error to detect keyterm issues
            const classified = classifyError(errorMessage);

            // Emit transcription/failed to update job/transcript status
            try {
                await sendInngestEvent({
                    name: "transcription/failed",
                    data: {
                        transcriptId,
                        jobId,
                        error: errorMessage,
                        errorType: classified.type,
                    },
                });
            } catch (sendError) {
                console.error("[inngest] Failed to emit transcription/failed:", sendError);
                // Fallback: write error directly so the UI can surface it
                await writeTranscriptionFailureFallback({
                    transcriptId,
                    jobId,
                    error: {
                        error_message: classified.message,
                        error_type: classified.type,
                        error_detail: errorMessage.slice(0, 500),
                    },
                    context: "onFailure",
                });
            }
        },
    },
    async ({ event, step }) => {
        const { transcriptId, jobId, userId, keyTerms } = event.data;
        const transcription = resolveTranscriptionOptions(event.data.transcriptionOptions);

        console.log(`[inngest] Transcription requested for transcript: ${transcriptId}`);

        // Step 1: Start the engine's job, for the file the row points at now
        // (preparation may have replaced the upload), and only while this job
        // is still the transcript's waiting job. The step keeps the id it had
        // when Deepgram was the only engine: a new id would let a run caught
        // mid-deploy start the engine twice.
        const result = await step.run("call-deepgram-async", async () => {
            const supabase = createAdminClient();
            if (!(await jobQueued(supabase, { transcriptId, jobId }))) {
                return { skipped: true as const };
            }
            // The same check media preparation makes: only this user's own
            // file, inside the transcript's folder, goes to the engine.
            const row = await readSourceRow(supabase, transcriptId);
            const sourceKey = row && ownedSourceKey(row, { transcriptId, userId });
            if (!sourceKey) {
                throw new Error(`Transcript ${transcriptId} has no media of its own`);
            }
            const mediaUrlResult = await getMediaUrlForEngine(supabase, sourceKey);
            if (mediaUrlResult.error || !mediaUrlResult.url) {
                throw new Error(mediaUrlResult.error ?? "Failed to generate media URL");
            }
            const response = await getEngine(transcription.engine).start({
                mediaUrl: mediaUrlResult.url,
                transcriptId,
                jobId,
                keyTerms,
                options: transcription,
            });

            if (response.error) {
                throw new Error(response.error);
            }

            return { skipped: false as const, requestId: response.requestId };
        });

        if (result.skipped) {
            console.log(`[inngest] Job ${jobId} is no longer queued; not starting ${transcription.engine}`);
            return { status: "skipped", transcriptId, jobId };
        }

        // Step 2: Transition job to processing (transcript status derived by trigger)
        await step.run("update-job-status", async () => {
            const supabase = createAdminClient();

            const { outcome, error: transitionError } = await transitionJob({
                supabase,
                jobId,
                to: "processing",
                extraJobFields: {
                    inngest_event_id: result.requestId,
                    started_at: new Date().toISOString(),
                },
                context: "handleTranscriptionRequested",
            });

            if (outcome === "noop") {
                console.log(`[inngest] Job ${jobId} already processing (idempotent replay)`);
                return;
            }

            if (outcome === "invalid" || outcome === "conflict") {
                throw new Error(`Failed to transition job ${jobId} to processing: ${transitionError || outcome}`);
            }

            console.log(`[inngest] Job ${jobId} updated with request_id: ${result.requestId}`);
        });

        return {
            status: "processing",
            transcriptId,
            jobId,
            requestId: result.requestId,
        };
    }
);
