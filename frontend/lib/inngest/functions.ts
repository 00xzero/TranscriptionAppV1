/**
 * Inngest Functions
 * 
 * Background job handlers for the transcription lifecycle.
 * These are skeleton implementations - actual logic added in Phase 5-6.
 */

import { inngest } from "./client";

// Configurable concurrency limit for Deepgram API calls
const DEEPGRAM_CONCURRENCY = parseInt(
    process.env.DEEPGRAM_CONCURRENCY_LIMIT || "5",
    10
);

/**
 * Handle transcription request
 * Triggered when user starts a new transcription job.
 * Phase 5: Will call Deepgram async API and store request_id.
 */
export const handleTranscriptionRequested = inngest.createFunction(
    {
        id: "handle-transcription-requested",
        concurrency: {
            scope: "account",
            key: '"deepgram"', // Shared queue for Deepgram API calls
            limit: DEEPGRAM_CONCURRENCY,
        },
        retries: 2,
    },
    { event: "transcription/requested" },
    async ({ event, step }) => {
        const { projectId, userId, mediaUrl, keyTerms } = event.data;

        // Phase 5: Call Deepgram async API with callback URL
        // Phase 5: Store request_id in jobs table
        // Phase 5: Update job status to "processing"

        console.log(`[Skeleton] Transcription requested for project: ${projectId}`);

        return {
            status: "skeleton",
            projectId,
            userId,
            mediaUrl: mediaUrl.substring(0, 50) + "...",
            keyTermsCount: keyTerms?.length || 0,
        };
    }
);

/**
 * Handle Deepgram webhook callback
 * Triggered when Deepgram completes transcription and sends results.
 * Phase 5: Will parse utterances/words and store in DB.
 * Phase 6: Will trigger consolidation pipeline.
 */
export const handleTranscriptionWebhook = inngest.createFunction(
    {
        id: "handle-transcription-webhook",
        retries: 3,
    },
    { event: "transcription/webhook" },
    async ({ event, step }) => {
        const { requestId, projectId } = event.data;

        // Phase 5: Parse Deepgram utterances/words
        // Phase 5: Store segments with speaker mapping
        // Phase 5: Store words with timestamps
        // Phase 6: Trigger consolidation pipeline

        console.log(`[Skeleton] Webhook received for request: ${requestId}`);

        return {
            status: "skeleton",
            requestId,
            projectId,
        };
    }
);

/**
 * Handle transcription completed
 * Triggered after successful processing and consolidation.
 * Phase 5: Will update job and project status.
 */
export const handleTranscriptionCompleted = inngest.createFunction(
    { id: "handle-transcription-completed" },
    { event: "transcription/completed" },
    async ({ event }) => {
        const { projectId, jobId, duration } = event.data;

        // Phase 5: Mark job as completed
        // Phase 5: Update project status to "completed"
        // Phase 5: Update project duration

        console.log(`[Skeleton] Transcription completed for project: ${projectId}`);

        return {
            status: "skeleton",
            projectId,
            jobId,
            duration,
        };
    }
);

/**
 * Handle transcription failure
 * Triggered when transcription fails for any reason.
 * Phase 5: Will classify error type and update job status.
 */
export const handleTranscriptionFailed = inngest.createFunction(
    { id: "handle-transcription-failed" },
    { event: "transcription/failed" },
    async ({ event }) => {
        const { projectId, jobId, error, errorType } = event.data;

        // Phase 5: Mark job as failed with error details
        // Phase 5: Classify error type (keyterm vs general)
        // Phase 5: Update project status to "error"

        console.log(`[Skeleton] Transcription failed for project: ${projectId}`);
        console.log(`[Skeleton] Error type: ${errorType}, message: ${error}`);

        return {
            status: "skeleton",
            projectId,
            jobId,
            error,
            errorType,
        };
    }
);
