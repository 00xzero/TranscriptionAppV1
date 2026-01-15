/**
 * Inngest Functions
 * 
 * Background job handlers for the transcription lifecycle.
 * Implements Deepgram async transcription with webhook callbacks.
 */

import { inngest } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
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
            await inngest.send({
                name: "transcription/failed",
                data: {
                    projectId,
                    jobId,
                    error: errorMessage,
                    errorType: classified.type,
                },
            });
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
            await inngest.send({
                name: "transcription/failed",
                data: {
                    projectId,
                    jobId,
                    error: errorMessage,
                    errorType: "transcription_error",
                },
            });
        },
    },
    { event: "transcription/webhook" },
    async ({ event, step }) => {
        const { requestId, projectId, result } = event.data;
        const response = result as DeepgramResponse;

        console.log(`[inngest] Webhook received for project: ${projectId}, request: ${requestId}`);

        // Step 1: Find the job for this project
        const job = await step.run("find-job", async () => {
            const supabase = createAdminClient();

            const { data, error } = await supabase
                .from("jobs")
                .select("id")
                .eq("project_id", projectId)
                .eq("status", "processing")
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

        // Step 3: Trigger completion event
        await step.sendEvent("trigger-completed", {
            name: "transcription/completed",
            data: {
                projectId,
                jobId: job.id,
                duration: Math.floor(transcriptionResult.durationMs / 1000),
            },
        });

        console.log(
            `[inngest] Transcription stored: ${transcriptionResult.segmentCount} segments, ` +
            `${transcriptionResult.wordCount} words, ${transcriptionResult.durationMs}ms duration`
        );

        return {
            status: "stored",
            projectId,
            jobId: job.id,
            ...transcriptionResult,
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
        const { projectId, jobId, duration } = event.data;

        console.log(`[inngest] Transcription completed for project: ${projectId}`);

        await step.run("update-status", async () => {
            const supabase = createAdminClient();
            const now = new Date().toISOString();

            // Update job status
            const { error: jobError } = await supabase
                .from("jobs")
                .update({
                    status: "completed",
                    finished_at: now,
                })
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
                    .eq("status", "processing")
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                
                if (job) {
                    jobId = job.id;
                    console.log(`[inngest] Found job ${jobId} by projectId lookup`);
                }
            }

            // Update job with error details (only if we have a jobId)
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

            console.log(`[inngest] Project ${projectId} marked as error: ${finalErrorType}`);
        });

        return {
            status: "failed",
            projectId,
            jobId: providedJobId,
            error,
            errorType,
        };
    }
);
