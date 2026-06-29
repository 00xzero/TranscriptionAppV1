/**
 * Handle transcription completed
 * Triggered after successful processing.
 * Updates job and transcript status.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { transitionJob } from "@/core/transcription/transition";
import { transcriptionCompletedTrigger } from "@/lib/inngest/events";

export const handleTranscriptionCompleted = inngest.createFunction(
    {
        id: "handle-transcription-completed",
        triggers: [{ event: transcriptionCompletedTrigger }],
        retries: 3,
    },
    async ({ event, step }) => {
        const { transcriptId, jobId, duration } = event.data;

        console.log(`[inngest] Transcription completed for transcript: ${transcriptId}`);

        await step.run("update-status", async () => {
            const supabase = createAdminClient();
            const now = new Date().toISOString();

            // Transition job to completed (transcript status derived by trigger)
            const { outcome, error: transitionError } = await transitionJob({
                supabase,
                jobId,
                to: "completed",
                extraJobFields: { finished_at: now },
                metadata: {},
                context: "handleTranscriptionCompleted",
            });

            if (outcome === "noop") {
                console.log(`[inngest] Job ${jobId} already completed (duplicate event, benign replay)`);
            } else if (outcome === "invalid" || outcome === "conflict") {
                throw new Error(
                    `Failed to transition job ${jobId} to completed: ${transitionError || outcome}`
                );
            }

            // Update transcript duration (metadata-only, no status)
            const { error: transcriptError } = await supabase
                .from("transcripts")
                .update({ duration_seconds: duration })
                .eq("id", transcriptId);

            if (transcriptError) {
                console.error("[inngest] Failed to update transcript duration:", transcriptError);
                throw new Error(`Failed to update transcript duration: ${transcriptError.message}`);
            }

            console.log(`[inngest] Transcript ${transcriptId} marked as completed`);
        });

        return {
            status: "completed",
            transcriptId,
            jobId,
            duration,
        };
    }
);
