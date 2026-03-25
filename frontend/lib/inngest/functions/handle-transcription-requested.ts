/**
 * Handle transcription request
 * Triggered when user starts a new transcription job.
 * Calls Deepgram async API and stores request_id.
 *
 * On failure (e.g., Deepgram API rejection), emits transcription/failed
 * so job/project status is updated and users see the error.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { transitionJob } from "@/core/transcription/transition";
import {
    startAsyncTranscription,
    getCallbackUrl,
    classifyError,
} from "@/infra/deepgram";
import { writeTranscriptionFailureFallback } from "./_shared";

// Configurable concurrency limit for Deepgram API calls
const DEEPGRAM_CONCURRENCY = parseInt(
    process.env.DEEPGRAM_CONCURRENCY_LIMIT || "5",
    10
);

export const handleTranscriptionRequested = inngest.createFunction(
    {
        id: "handle-transcription-requested",
        concurrency: {
            scope: "account",
            key: '"deepgram"', // Shared queue for Deepgram API calls
            limit: DEEPGRAM_CONCURRENCY,
        },
        retries: 2,
        onFailure: async ({ event, error }) => {
            // When retries are exhausted, emit failure event
            const originalEvent = event.data.event;
            const { projectId, jobId } = originalEvent.data;
            const errorMessage = error.message || String(error);

            console.error(`[inngest] Transcription request failed for project ${projectId}:`, errorMessage);

            // Classify error to detect keyterm issues
            const classified = classifyError(errorMessage);

            // Emit transcription/failed to update job/project status
            try {
                await inngest.send({
                    name: "transcription/failed",
                    data: {
                        projectId,
                        jobId,
                        error: errorMessage,
                        errorType: classified.type,
                    },
                });
            } catch (sendError) {
                console.error("[inngest] Failed to emit transcription/failed:", sendError);
                // Fallback: write error directly so the UI can surface it
                const payload = {
                    error: classified.message,
                    error_type: classified.type,
                    raw_error: errorMessage.slice(0, 500),
                };
                await writeTranscriptionFailureFallback({
                    projectId,
                    jobId,
                    payload,
                    context: "onFailure",
                });
            }
        },
    },
    { event: "transcription/requested" },
    async ({ event, step }) => {
        const { projectId, jobId, userId, mediaUrl, keyTerms } = event.data;

        console.log(`[inngest] Transcription requested for project: ${projectId}`);

        // Step 1: Call Deepgram async API
        const result = await step.run("call-deepgram-async", async () => {
            const callbackUrl = getCallbackUrl();
            console.log(`[inngest] Using callback URL: ${callbackUrl}`);

            const response = await startAsyncTranscription({
                mediaUrl,
                callbackUrl,
                projectId,
                keyTerms,
            });

            if (response.error) {
                throw new Error(response.error);
            }

            return { requestId: response.requestId };
        });

        // Step 2: Transition job to processing (project status derived by trigger)
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
            projectId,
            jobId,
            requestId: result.requestId,
        };
    }
);
