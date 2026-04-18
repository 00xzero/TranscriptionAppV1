/**
 * Handle Deepgram webhook callback
 * Triggered when Deepgram completes transcription and sends results.
 * Parses utterances/words and stores in Supabase.
 *
 * On failure (after retries exhausted), emits transcription/failed event
 * so the UI can surface the error to the user.
 */

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { runConsolidation } from "@/core/transcript/consolidation-service";
import {
    DEFAULT_SEGMENT_BUILDER_CONFIG,
    NormalizedWord,
    buildSegments,
    normalizeWords,
} from "@/core/transcript/segment-builder";
import { DeepgramWebhookPayloadSchema } from "@/contracts/webhook";
import { transcriptionWebhookTrigger } from "@/lib/inngest/events";
import { writeTranscriptionFailureFallback } from "./_shared";

export const handleTranscriptionWebhook = inngest.createFunction(
    {
        id: "handle-transcription-webhook",
        triggers: [{ event: transcriptionWebhookTrigger }],
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
            let jobId: string | undefined;
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
                await sendInngestEvent({
                    name: "transcription/failed",
                    data: {
                        projectId,
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
                    projectId,
                    jobId,
                    payload,
                    context: "onFailure",
                });
            }
        },
    },
    async ({ event, step }) => {
        const { requestId, projectId } = event.data;

        console.log(`[inngest] Webhook received for project: ${projectId}, request: ${requestId}`);

        // Step 1: Find the job for this project
        const job = await step.run("find-job", async () => {
            const supabase = createAdminClient();

            const { data, error } = await supabase
                .from("jobs")
                .select("id, status")
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

        // Guard against late replays — job already completed means segments/chunks are final
        if (job.status === "completed") {
            console.log(`[inngest] Job ${job.id} already completed — skipping replay for project ${projectId}`);
            return { status: "skipped", projectId, jobId: job.id };
        }

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
                segmentWords: NormalizedWord[],
                isFiller: boolean,
                algoVersion: string
            ): Promise<void> {
                const { data: segment, error: segError } = await supabase
                    .from("segments")
                    .insert({
                        project_id: projectId,
                        speaker_id: speakerId,
                        start_ms: startMs,
                        end_ms: endMs,
                        text,
                        is_filler: isFiller,
                        algo_version: algoVersion,
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

            if (words.length > 0) {
                const normalizedWords = normalizeWords(words, alt?.paragraphs ?? null);
                const builtSegments = buildSegments(
                    normalizedWords,
                    DEFAULT_SEGMENT_BUILDER_CONFIG
                );

                for (const segment of builtSegments) {
                    maxEndMs = Math.max(maxEndMs, segment.endMs);

                    let speakerId: string | null = null;
                    if (typeof segment.speakerNum === "number") {
                        speakerId = await getOrCreateSpeaker(segment.speakerNum);
                    }

                    await insertSegment(
                        speakerId,
                        segment.startMs,
                        segment.endMs,
                        segment.text,
                        segment.words,
                        segment.isFiller,
                        segment.algoVersion
                    );
                }
            } else {
                // No words returned; create empty segment
                await insertSegment(
                    null,
                    0,
                    0,
                    alt?.transcript || "",
                    [],
                    false,
                    DEFAULT_SEGMENT_BUILDER_CONFIG.algoVersion
                );
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
