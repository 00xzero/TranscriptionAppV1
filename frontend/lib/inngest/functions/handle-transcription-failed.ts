/**
 * Handle transcription failure
 * Triggered when transcription fails for any reason.
 * Classifies error type and updates job/transcript status.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { transitionJob } from "@/core/transcription/transition";
import { classifyError } from "@/infra/deepgram";
import { transcriptionFailedTrigger } from "@/lib/inngest/events";

export const handleTranscriptionFailed = inngest.createFunction(
    {
        id: "handle-transcription-failed",
        triggers: [{ event: transcriptionFailedTrigger }],
        retries: 1,
    },
    async ({ event, step }) => {
        const { transcriptId, jobId: providedJobId, error, errorType } = event.data;

        console.log(`[inngest] Transcription failed for transcript: ${transcriptId}`);
        console.log(`[inngest] Error type: ${errorType}, message: ${error}`);

        await step.run("update-error-status", async () => {
            const supabase = createAdminClient();
            const now = new Date().toISOString();

            // Coerce error to string for safe slicing
            const errorString = typeof error === "string" ? error : String(error);

            // Classify error if not already classified
            const classified = classifyError(errorString);
            const finalErrorType = errorType || classified.type;
            const finalMessage = classified.message;

            // If jobId is empty, try to find the most recent processing job for this transcript
            let jobId = providedJobId;
            if (!jobId) {
                console.log("[inngest] No jobId provided, looking up by transcriptId");
                const { data: job, error: lookupError } = await supabase
                    .from("jobs")
                    .select("id")
                    .eq("transcript_id", transcriptId)
                    .in("status", ["processing", "queued"])
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (lookupError) {
                    console.error("[inngest] Failed to lookup job by transcriptId:", lookupError);
                    throw new Error(`Job lookup failed for transcript ${transcriptId}: ${lookupError.message}`);
                }

                if (job) {
                    jobId = job.id;
                    console.log(`[inngest] Found job ${jobId} by transcriptId lookup`);
                }
            }

            // Transition job to error (transcript status derived by trigger)
            if (jobId) {
                const { outcome, error: transitionError } = await transitionJob({
                    supabase,
                    jobId,
                    to: "error",
                    extraJobFields: {
                        finished_at: now,
                        payload: {
                            error: finalMessage,
                            error_type: finalErrorType,
                            raw_error: errorString.slice(0, 500),
                        },
                    },
                    metadata: { error_type: finalErrorType },
                    context: "handleTranscriptionFailed",
                });

                if (outcome === "noop") {
                    console.log(`[inngest] Job ${jobId} already in error state (idempotent replay)`);
                } else if (outcome === "invalid" || outcome === "conflict") {
                    throw new Error(
                        `Failed to transition job ${jobId} to error: ${transitionError || outcome}`
                    );
                }
            } else {
                console.error("[inngest] No job found to update for transcript:", transcriptId);

                const { error: transcriptError } = await supabase
                    .from("transcripts")
                    .update({ status: "error" })
                    .eq("id", transcriptId);

                if (transcriptError) {
                    throw new Error(
                        `Failed to mark transcript ${transcriptId} as error without a job: ${transcriptError.message}`
                    );
                }
            }

            console.log(`[inngest] Transcript ${transcriptId} marked as error: ${finalErrorType}`);
        });

        return {
            status: "error",
            transcriptId,
            jobId: providedJobId,
            error,
            errorType,
        };
    }
);
