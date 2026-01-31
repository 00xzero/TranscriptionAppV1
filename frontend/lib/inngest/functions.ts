/**
 * Inngest Functions
 * 
 * Background job handlers for the transcription lifecycle.
 * Implements Deepgram async transcription with webhook callbacks.
 */

import { inngest } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runConsolidation } from "@/lib/inngest/consolidation-service";
import {
    startAsyncTranscription,
    getCallbackUrl,
    classifyError,
    getMajoritySpeaker,
    DeepgramResponse,
    DeepgramWord,
    DeepgramUtterance,
} from "@/lib/deepgram";

// Configurable concurrency limit for Deepgram API calls
const DEEPGRAM_CONCURRENCY = parseInt(
    process.env.DEEPGRAM_CONCURRENCY_LIMIT || "5",
    10
);

type TranscriptionFailurePayload = {
    error: string;
    error_type: string;
    raw_error: string;
};

async function writeTranscriptionFailureFallback({
    projectId,
    jobId,
    payload,
    context,
}: {
    projectId: string;
    jobId?: string;
    payload: TranscriptionFailurePayload;
    context: string;
}) {
    try {
        const supabase = createAdminClient();
        const now = new Date().toISOString();

        if (jobId) {
            const { error: jobError } = await supabase
                .from("jobs")
                .update({
                    status: "error",
                    finished_at: now,
                    payload,
                })
                .eq("id", jobId);
            if (jobError) {
                console.error(`[inngest] Failed to update job in ${context} fallback:`, jobError);
            }
        }

        const { error: projectError } = await supabase
            .from("projects")
            .update({ status: "error" })
            .eq("id", projectId);
        if (projectError) {
            console.error(`[inngest] Failed to update project in ${context} fallback:`, projectError);
        }
    } catch (dbError) {
        console.error(`[inngest] ${context} fallback failed:`, dbError);
    }
}

/**
 * Handle transcription request
 * Triggered when user starts a new transcription job.
 * Calls Deepgram async API and stores request_id.
 * 
 * On failure (e.g., Deepgram API rejection), emits transcription/failed
 * so job/project status is updated and users see the error.
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

        // Step 2: Update job with request_id and status
        await step.run("update-job-status", async () => {
            const supabase = createAdminClient();

            const { error } = await supabase
                .from("jobs")
                .update({
                    status: "processing",
                    inngest_event_id: result.requestId,
                    started_at: new Date().toISOString(),
                })
                .eq("id", jobId);

            if (error) {
                console.error("[inngest] Failed to update job:", error);
                throw new Error(`Failed to update job: ${error.message}`);
            }

            console.log(`[inngest] Job ${jobId} updated with request_id: ${result.requestId}`);
        });

        // Step 3: Update project to processing
        await step.run("update-project-status", async () => {
            const supabase = createAdminClient();
            const { error } = await supabase
                .from("projects")
                .update({ status: "processing" })
                .eq("id", projectId);

            if (error) {
                console.error("[inngest] Failed to update project:", error);
                throw new Error(`Failed to update project: ${error.message}`);
            }
        });

        return {
            status: "processing",
            projectId,
            jobId,
            requestId: result.requestId,
        };
    }
);

/**
 * Handle Deepgram webhook callback
 * Triggered when Deepgram completes transcription and sends results.
 * Parses utterances/words and stores in Supabase.
 * 
 * On failure (after retries exhausted), emits transcription/failed event
 * so the UI can surface the error to the user.
 */
export const handleTranscriptionWebhook = inngest.createFunction(
    {
        id: "handle-transcription-webhook",
        retries: 3,
        // Limit to 1 concurrent execution per project to prevent
        // interleaving of consolidation (which deletes and re-inserts chunks)
        concurrency: {
            limit: 1,
            key: "event.data.projectId",
        },
        onFailure: async ({ event, error }) => {
            // When retries are exhausted, emit failure event so job/project get error status
            // In onFailure, original event is nested under event.data.event
            const originalEvent = event.data.event;
            const { projectId, requestId } = originalEvent.data;
            const errorMessage = error.message || String(error);

            console.error(`[inngest] Webhook handler failed for project ${projectId}:`, errorMessage);

            // Look up the job by requestId to get the real jobId
            let jobId = "";
            try {
                const supabase = createAdminClient();
                const { data: job } = await supabase
                    .from("jobs")
                    .select("id")
                    .eq("project_id", projectId)
                    .eq("inngest_event_id", requestId)
                    .single();

                if (job) {
                    jobId = job.id;
                }
            } catch (lookupError) {
                console.error("[inngest] Failed to lookup job in onFailure:", lookupError);
            }

            // Emit transcription/failed to update job/project status
            try {
                await inngest.send({
                    name: "transcription/failed",
                    data: {
                        projectId,
                        jobId,
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
                    projectId,
                    jobId,
                    payload,
                    context: "onFailure",
                });
            }
        },
    },
    { event: "transcription/webhook" },
    async ({ event, step }) => {
        const { requestId, projectId } = event.data;

        console.log(`[inngest] Webhook received for project: ${projectId}, request: ${requestId}`);

        // Step 1: Find the job for this project
        const job = await step.run("find-job", async () => {
            const supabase = createAdminClient();

            const { data, error } = await supabase
                .from("jobs")
                .select("id")
                .eq("project_id", projectId)
                .eq("inngest_event_id", requestId)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();

            if (error || !data) {
                console.error("[inngest] Job not found for project:", projectId, "requestId:", requestId);
                throw new Error(`Job not found for project: ${projectId}, requestId: ${requestId}`);
            }

            return data;
        });

        // Step 2: Parse and store transcription results
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

            const jobPayload = (jobRow as { payload: any }).payload;
            const response = jobPayload?.deepgram as DeepgramResponse | undefined;

            if (!response) {
                throw new Error("Deepgram payload missing from job payload");
            }

            // Parse Deepgram response
            // Utterances can be at results level or under alternatives (legacy worker handled both)
            const results = response.results || {};
            const channels = results.channels || [];
            const alt = channels[0]?.alternatives?.[0];
            const utterances = results.utterances || (alt as { utterances?: DeepgramUtterance[] })?.utterances;
            const words = alt?.words || [];

            // Clear existing segments for idempotency
            const { error: deleteError } = await supabase
                .from("segments")
                .delete()
                .eq("project_id", projectId);

            if (deleteError) {
                console.error("[inngest] Failed to clear segments:", deleteError);
                throw new Error(`Failed to clear segments: ${deleteError.message}`);
            }

            let maxEndMs = 0;
            let segmentCount = 0;
            let wordCount = 0;

            // Speaker cache: speaker number -> speaker ID
            const speakerCache: Record<number, string> = {};

            // Helper: Get or create speaker using upsert (requires UNIQUE constraint on project_id, label)
            async function getOrCreateSpeaker(speakerNum: number): Promise<string> {
                if (speakerCache[speakerNum]) {
                    return speakerCache[speakerNum];
                }

                const label = `Speaker ${speakerNum}`;

                // Upsert speaker - DB uniqueness constraint prevents duplicates
                const { data: speaker, error } = await supabase
                    .from("speakers")
                    .upsert(
                        { project_id: projectId, label },
                        { onConflict: "project_id,label" }
                    )
                    .select("id")
                    .single();

                if (error || !speaker) {
                    throw new Error(`Failed to upsert speaker: ${error?.message}`);
                }

                speakerCache[speakerNum] = speaker.id;
                return speaker.id;
            }

            // Helper: Insert segment with words
            async function insertSegment(
                speakerId: string | null,
                startMs: number,
                endMs: number,
                text: string,
                segmentWords: DeepgramWord[]
            ): Promise<void> {
                const { data: segment, error: segError } = await supabase
                    .from("segments")
                    .insert({
                        project_id: projectId,
                        speaker_id: speakerId,
                        start_ms: startMs,
                        end_ms: endMs,
                        text,
                    })
                    .select("id")
                    .single();

                if (segError || !segment) {
                    throw new Error(`Failed to insert segment: ${segError?.message}`);
                }

                segmentCount++;

                // Insert words for this segment
                if (segmentWords.length > 0) {
                    const wordRows = segmentWords.map((w, idx) => ({
                        segment_id: segment.id,
                        start_ms: Math.round(w.start * 1000),
                        end_ms: Math.round(w.end * 1000),
                        text: w.word,
                        confidence: w.confidence,
                        order_index: idx,
                    }));

                    const { error: wordError } = await supabase
                        .from("words")
                        .insert(wordRows);

                    if (wordError) {
                        throw new Error(`Failed to insert words: ${wordError.message}`);
                    }

                    wordCount += wordRows.length;
                }
            }

            // Process utterances (preferred) or words
            if (utterances && utterances.length > 0) {
                for (const utt of utterances as DeepgramUtterance[]) {
                    const startMs = Math.round(utt.start * 1000);
                    const endMs = Math.round(utt.end * 1000);
                    maxEndMs = Math.max(maxEndMs, endMs);

                    // Determine majority speaker
                    const speakerNum = getMajoritySpeaker(utt.words || []);
                    let speakerId: string | null = null;

                    if (typeof speakerNum === "number") {
                        speakerId = await getOrCreateSpeaker(speakerNum);
                    }

                    await insertSegment(
                        speakerId,
                        startMs,
                        endMs,
                        utt.transcript || "",
                        utt.words || []
                    );
                }
            } else if (words.length > 0) {
                // Fallback: single segment covering all words
                const startMs = Math.round(words[0].start * 1000);
                const endMs = Math.round(words[words.length - 1].end * 1000);
                maxEndMs = Math.max(maxEndMs, endMs);

                const speakerNum = getMajoritySpeaker(words);
                let speakerId: string | null = null;

                if (typeof speakerNum === "number") {
                    speakerId = await getOrCreateSpeaker(speakerNum);
                }

                const transcript = alt?.transcript || "";
                await insertSegment(speakerId, startMs, endMs, transcript, words);
            } else {
                // No words returned; create empty segment
                await insertSegment(null, 0, 0, alt?.transcript || "", []);
            }

            return {
                segmentCount,
                wordCount,
                durationMs: maxEndMs,
            };
        });

        // Step 3: Run consolidation pipeline (if enabled)
        // Wrapped in try-catch so consolidation failure doesn't fail the entire transcription
        const consolidationEnabled = process.env.CONSOLIDATION_ENABLED !== "false";
        const consolidationResult = await step.run("run-consolidation", async () => {
            if (!consolidationEnabled) {
                console.log(`[inngest] Consolidation DISABLED for project: ${projectId} (CONSOLIDATION_ENABLED=false)`);
                return {
                    chunkCount: 0,
                    chunkWordCount: 0,
                    algoVersion: "skipped",
                    consolidationError: null,
                };
            }
            console.log(`[inngest] Running consolidation for project: ${projectId}`);
            try {
                const result = await runConsolidation(projectId);
                return {
                    ...result,
                    consolidationError: null,
                };
            } catch (consolidationError) {
                // Log but don't throw - transcription segments still exist and are usable
                const errorMessage = consolidationError instanceof Error
                    ? consolidationError.message
                    : String(consolidationError);
                console.error(`[inngest] Consolidation failed for project ${projectId}:`, errorMessage);
                return {
                    chunkCount: 0,
                    chunkWordCount: 0,
                    algoVersion: "failed",
                    consolidationError: errorMessage,
                };
            }
        });

        // Step 4: Trigger completion event
        console.log(`[inngest] Sending transcription/completed event for project: ${projectId}, consolidation: ${consolidationEnabled ? 'enabled' : 'disabled'}`);
        await step.sendEvent("trigger-completed", {
            name: "transcription/completed",
            data: {
                projectId,
                jobId: job.id,
                duration: Math.floor(transcriptionResult.durationMs / 1000),
                chunkCount: consolidationResult.chunkCount,
                chunkWordCount: consolidationResult.chunkWordCount,
                algoVersion: consolidationResult.algoVersion,
                consolidationError: consolidationResult.consolidationError,
            },
        });
        console.log(`[inngest] transcription/completed event sent successfully for project: ${projectId}`);

        console.log(
            `[inngest] Transcription stored: ${transcriptionResult.segmentCount} segments, ` +
            `${transcriptionResult.wordCount} words, ${transcriptionResult.durationMs}ms duration`
        );
        console.log(
            `[inngest] Consolidation complete: ${consolidationResult.chunkCount} chunks, ` +
            `${consolidationResult.chunkWordCount} chunk_words (${consolidationResult.algoVersion})`
        );

        return {
            status: "stored",
            projectId,
            jobId: job.id,
            ...transcriptionResult,
            ...consolidationResult,
        };
    }
);

/**
 * Handle transcription completed
 * Triggered after successful processing.
 * Updates job and project status.
 */
export const handleTranscriptionCompleted = inngest.createFunction(
    { id: "handle-transcription-completed", retries: 3 },
    { event: "transcription/completed" },
    async ({ event, step }) => {
        const { projectId, jobId, duration, consolidationError } = event.data;

        console.log(`[inngest] Transcription completed for project: ${projectId}`);
        if (consolidationError) {
            console.warn(`[inngest] Consolidation had an error (transcription still completed): ${consolidationError}`);
        }

        await step.run("update-status", async () => {
            const supabase = createAdminClient();
            const now = new Date().toISOString();

            // Build job update payload, include consolidation warning if applicable
            const jobUpdate: Record<string, unknown> = {
                status: "completed",
                finished_at: now,
            };
            if (consolidationError) {
                const { data: payloadRow, error: payloadError } = await supabase
                    .from("jobs")
                    .select("payload")
                    .eq("id", jobId)
                    .maybeSingle();

                if (payloadError) {
                    console.error("[inngest] Failed to load existing job payload:", payloadError);
                } else {
                    const existingPayload =
                        payloadRow?.payload && typeof payloadRow.payload === "object"
                            ? (payloadRow.payload as Record<string, unknown>)
                            : {};

                    jobUpdate.payload = {
                        ...existingPayload,
                        consolidation_warning: consolidationError,
                    };
                }
            }

            // Update job status
            const { error: jobError } = await supabase
                .from("jobs")
                .update(jobUpdate)
                .eq("id", jobId);

            if (jobError) {
                console.error("[inngest] Failed to update job:", jobError);
            }

            // Update project status and duration
            const { error: projectError } = await supabase
                .from("projects")
                .update({
                    status: "completed",
                    duration_seconds: duration,
                })
                .eq("id", projectId);

            if (projectError) {
                console.error("[inngest] Failed to update project:", projectError);
            } else {
                console.log(`[inngest] Project ${projectId} status updated to 'completed' in database`);
            }

            if (jobError || projectError) {
                throw new Error(
                    `Failed to update completion status: ${jobError?.message || "job ok"} / ${projectError?.message || "project ok"}`
                );
            }

            console.log(`[inngest] Project ${projectId} marked as completed`);
        });

        return {
            status: "completed",
            projectId,
            jobId,
            duration,
        };
    }
);

/**
 * Handle transcription failure
 * Triggered when transcription fails for any reason.
 * Classifies error type and updates job/project status.
 */
export const handleTranscriptionFailed = inngest.createFunction(
    { id: "handle-transcription-failed", retries: 1 },
    { event: "transcription/failed" },
    async ({ event, step }) => {
        const { projectId, jobId: providedJobId, error, errorType } = event.data;

        console.log(`[inngest] Transcription failed for project: ${projectId}`);
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

            // If jobId is empty, try to find the most recent processing job for this project
            let jobId = providedJobId;
            if (!jobId) {
                console.log("[inngest] No jobId provided, looking up by projectId");
                const { data: job } = await supabase
                    .from("jobs")
                    .select("id")
                    .eq("project_id", projectId)
                    .in("status", ["processing", "queued"])
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (job) {
                    jobId = job.id;
                    console.log(`[inngest] Found job ${jobId} by projectId lookup`);
                }
            }

            // Update job with error details (only if we have a jobId)
            let jobUpdateError: { message: string } | null = null;
            if (jobId) {
                const { error: jobError } = await supabase
                    .from("jobs")
                    .update({
                        status: "error",
                        finished_at: now,
                        payload: {
                            error: finalMessage,
                            error_type: finalErrorType,
                            raw_error: errorString.slice(0, 500),
                        },
                    })
                    .eq("id", jobId);

                if (jobError) {
                    console.error("[inngest] Failed to update job:", jobError);
                    jobUpdateError = jobError;
                }
            } else {
                console.error("[inngest] No job found to update for project:", projectId);
            }

            // Update project status
            const { error: projectError } = await supabase
                .from("projects")
                .update({ status: "error" })
                .eq("id", projectId);

            if (projectError) {
                console.error("[inngest] Failed to update project:", projectError);
            }

            if (jobUpdateError || projectError) {
                throw new Error(
                    `Failed to update error status: ${jobUpdateError?.message || "job ok"} / ${projectError?.message || "project ok"}`
                );
            }

            console.log(`[inngest] Project ${projectId} marked as error: ${finalErrorType}`);
        });

        return {
            status: "error",
            projectId,
            jobId: providedJobId,
            error,
            errorType,
        };
    }
);

/**
 * Detect and mark stuck transcription jobs.
 * Runs on a schedule to fail jobs that have exceeded the timeout threshold.
 */
export const handleTranscriptionTimeouts = inngest.createFunction(
    {
        id: "handle-transcription-timeouts",
        concurrency: {
            limit: 1,
            key: '"transcription-timeouts"',
        },
    },
    { cron: "*/10 * * * *" },
    async ({ step }) => {
        const timeoutMinutes = parseInt(
            process.env.TRANSCRIPTION_TIMEOUT_MINUTES || "45",
            10
        );
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const now = Date.now();
        const cutoffIso = new Date(now - timeoutMs).toISOString();

        const staleJobs = await step.run("find-stale-jobs", async () => {
            const supabase = createAdminClient();
            const { data: processingJobs, error: processingError } = await supabase
                .from("jobs")
                .select("id, project_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "processing")
                .lt("started_at", cutoffIso);

            if (processingError) {
                throw new Error(`Failed to load processing jobs for timeout check: ${processingError.message}`);
            }

            const { data: processingNoStartJobs, error: processingNoStartError } = await supabase
                .from("jobs")
                .select("id, project_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "processing")
                .is("started_at", null)
                .lt("created_at", cutoffIso);

            if (processingNoStartError) {
                throw new Error(`Failed to load processing jobs without start time: ${processingNoStartError.message}`);
            }

            const { data: queuedJobs, error: queuedError } = await supabase
                .from("jobs")
                .select("id, project_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "queued")
                .lt("created_at", cutoffIso);

            if (queuedError) {
                throw new Error(`Failed to load queued jobs for timeout check: ${queuedError.message}`);
            }

            return [
                ...(processingJobs || []),
                ...(processingNoStartJobs || []),
                ...(queuedJobs || []),
            ];
        });

        if (staleJobs.length === 0) {
            return { timedOutJobs: 0, timeoutMinutes };
        }

        await step.run("mark-stale-jobs", async () => {
            const supabase = createAdminClient();
            const finishedAt = new Date().toISOString();
            const errorMessage = `Transcription timed out after ${timeoutMinutes} minutes. Please try again.`;
            const failures: { id: string; message: string }[] = [];
            const updatedProjectIds = new Set<string>();

            for (const job of staleJobs) {
                try {
                    let currentPayload: Record<string, unknown> = {};
                    if (job.status === "processing") {
                        const { data: payloadRow, error: payloadError } = await supabase
                            .from("jobs")
                            .select("payload")
                            .eq("id", job.id)
                            .maybeSingle();
                        if (payloadError) {
                            throw new Error(`Failed to load payload for job ${job.id}: ${payloadError.message}`);
                        }
                        if (payloadRow?.payload && typeof payloadRow.payload === "object") {
                            currentPayload = payloadRow.payload as Record<string, unknown>;
                        }
                    }

                    const nextPayload = {
                        ...currentPayload,
                        error: errorMessage,
                        error_type: "transcription_error",
                        raw_error: "timeout",
                    };

                    const { data: updatedJobs, error: jobError } = await supabase
                        .from("jobs")
                        .update({
                            status: "error",
                            finished_at: finishedAt,
                            payload: nextPayload,
                        })
                        .eq("id", job.id)
                        .in("status", ["queued", "processing"])
                        .select("id");

                    if (jobError) {
                        throw new Error(`Failed to mark job ${job.id} as timed out: ${jobError.message}`);
                    }
                    if (!updatedJobs || updatedJobs.length === 0) {
                        throw new Error(`Failed to mark job ${job.id} as timed out: no rows updated`);
                    }

                    updatedProjectIds.add(job.project_id);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    failures.push({ id: job.id, message });
                }
            }

            const projectIds = Array.from(updatedProjectIds);
            if (projectIds.length > 0) {
                const { error: projectError } = await supabase
                    .from("projects")
                    .update({ status: "error" })
                    .in("id", projectIds)
                    .in("status", ["queued", "processing"]);

                if (projectError) {
                    throw new Error(`Failed to mark projects as timed out: ${projectError.message}`);
                }
            }

            if (failures.length > 0) {
                const summary = failures
                    .map((failure) => `${failure.id}: ${failure.message}`)
                    .join("; ");
                throw new Error(`Failed to mark ${failures.length} job(s) as timed out: ${summary}`);
            }
        });

        return { timedOutJobs: staleJobs.length, timeoutMinutes };
    }
);
