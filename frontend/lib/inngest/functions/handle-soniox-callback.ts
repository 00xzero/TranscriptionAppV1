/**
 * Handle a Soniox callback (passed on by app/api/webhooks/soniox).
 *
 * Soniox's callback carries only the job's id and status, so the result is
 * fetched here, stored like any engine's (recordEngineResult), handed off to
 * transcription/webhook, and only then deleted at Soniox, which otherwise keeps
 * it for 30 days. Our own records are read first, so a replayed or late
 * callback fetches nothing. Soniox's copy is never deleted before ours is safe:
 * when retries run out it stays there, retrievable, until its 30 days are up.
 * A stale callback keeps it too when its attempt failed (it may be wanted to
 * recover the transcript); only an orphaned start, whose job another request
 * replaced, is deleted straight away, since nothing of ours will ever read it.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import {
    deleteSonioxTranscription,
    fetchSonioxTranscript,
    fetchSonioxTranscription,
} from "@/infra/soniox";
import { confirmReceiptCompleted, persistWebhookFailure, recordEngineResult } from "@/core/transcription/webhook";
import type { SonioxCallbackData } from "@/contracts/events";
import { sonioxCallbackTrigger } from "@/lib/inngest/events";
import { readEngineCallbackState } from "@/lib/inngest/engine-callback-state";
import { onEngineCallbackFailure, recordedOutcome } from "@/lib/inngest/engine-callback";

/**
 * When retries run out. Soniox's copy is never deleted here: before the
 * handoff it is the only copy, and after it only cleanup failed. Exported for
 * tests.
 */
export async function onSonioxCallbackFailure({
    event,
    error,
}: {
    event: { data: { event: { data: SonioxCallbackData } } };
    error: Error;
}): Promise<void> {
    const { transcriptId, jobId, requestId } = event.data.event.data;
    await onEngineCallbackFailure("soniox", { transcriptId, jobId, requestId }, error);
}

export const handleSonioxCallback = inngest.createFunction(
    {
        id: "handle-soniox-callback",
        triggers: [{ event: sonioxCallbackTrigger }],
        retries: 4,
        // One callback per transcript at a time, like the result handler.
        concurrency: { limit: 1, key: "event.data.transcriptId" },
        onFailure: onSonioxCallbackFailure,
    },
    async ({ event, step }) => {
        const { transcriptId, jobId, requestId, status } = event.data;
        const exact = { transcriptId, jobId, requestId };

        const checked = await step.run("check", async () => {
            const state = await readEngineCallbackState(createAdminClient(), "soniox", exact);
            if (state.state === "not_ready") {
                throw new Error(`Job ${jobId} has not saved Soniox request ${requestId} yet`);
            }
            return state;
        });

        // A failed or missing attempt keeps Soniox's copy, retrievable; only an
        // orphaned start (another request replaced it) is deleted there.
        if (checked.state === "stale" && !checked.otherRequest) {
            console.log(`[inngest] Soniox callback ${requestId} is stale; leaving it`);
            return { status: "stale", transcriptId, jobId };
        }
        const orphaned = checked.state === "stale";
        if (orphaned) console.log(`[inngest] Soniox request ${requestId} was replaced on job ${jobId}; forgetting it at Soniox`);

        if (checked.state === "fresh" || checked.state === "stored") {
            const recorded = status === "completed"
                ? await step.run("store-result", async () => {
                    const supabase = createAdminClient();
                    // Resume from our own copy, already stored and linked, without
                    // storing it again; the transcript is never passed through a
                    // step's return value.
                    const stored = checked.state === "stored"
                        ? { storedObjectKey: checked.resultObjectKey }
                        : await Promise.all([fetchSonioxTranscription(requestId), fetchSonioxTranscript(requestId)])
                            .then(([transcription, transcript]) => ({
                                rawBody: JSON.stringify({ transcription: transcription.raw, transcript: transcript.raw }),
                            }));
                    const result = await recordEngineResult({
                        supabase,
                        engine: "soniox",
                        jobId,
                        requestId,
                        transcriptId,
                        ...stored,
                    });
                    return recordedOutcome("soniox", result);
                })
                : await step.run("record-failure", async () => {
                    // The transcript endpoint serves completed jobs only.
                    const { transcription } = await fetchSonioxTranscription(requestId);
                    const reason = transcription.error_message || transcription.error_type || "Soniox could not transcribe the audio";
                    const failed = await persistWebhookFailure({
                        supabase: createAdminClient(),
                        engine: "soniox",
                        jobId,
                        transcriptId,
                        requestId,
                        message: `Transcription failed: ${reason.slice(0, 200)}`,
                        detail: JSON.stringify({ error_type: transcription.error_type, error_message: transcription.error_message }),
                    });
                    if (failed === "job") return { state: "recorded" as const, attemptId: null };
                    if (failed === "stale") return { state: "stale" as const, attemptId: null };
                    throw new Error(`Could not record Soniox's failure for job ${jobId} yet`);
                });

            if (recorded.state === "stale") {
                // Why it changed is unknown here, so Soniox's copy is kept.
                console.log(`[inngest] Soniox job ${requestId} no longer matches job ${jobId}; leaving it`);
                return { status: "stale", transcriptId, jobId };
            }

            // A handoff counts once its receipt says so: recordEngineResult
            // tolerates a failed finalize, so it is confirmed here, in a
            // step of its own that retries without storing again.
            const attemptId = recorded.attemptId;
            if (attemptId) {
                await step.run("confirm-handoff", async () => {
                    const completed = await confirmReceiptCompleted(createAdminClient(), "soniox", requestId, attemptId);
                    if (!completed) throw new Error(`Soniox request ${requestId} was handed off by an attempt that has not finished`);
                });
            }
        }

        // Ours is safe (stored and handed off, or the failure recorded), the
        // transcript is gone, or the start was orphaned: Soniox's copy can go.
        await step.run("forget-at-soniox", () => deleteSonioxTranscription(requestId));

        return { status: orphaned ? "stale" : checked.state === "gone" ? "forgotten" : status, transcriptId, jobId };
    }
);
