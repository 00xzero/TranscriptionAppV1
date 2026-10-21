/**
 * Handle a Deepgram result (passed on by app/api/webhooks/deepgram).
 *
 * Deepgram sends the whole result in its callback, so the route stores it at
 * the job's own key and passes it on here; this hands it off to
 * transcription/webhook like any engine's result (recordEngineResult, resumed
 * from the stored file), with retries of its own. A route cut off before its
 * handoff is retried by Deepgram, and nothing here holds it up; a step cut off
 * here is retried by Inngest, which waits out its receipt's lease and carries
 * on from the stored file, however long Deepgram's own retries lasted.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { getTranscriptionResultPath } from "@/infra/supabase/storage";
import { removeTranscriptionResult } from "@/infra/supabase/transcription-results.server";
import { confirmReceiptCompleted, recordEngineResult } from "@/core/transcription/webhook";
import type { DeepgramCallbackData } from "@/contracts/events";
import { deepgramCallbackTrigger } from "@/lib/inngest/events";
import { readEngineCallbackState } from "@/lib/inngest/engine-callback-state";
import { onEngineCallbackFailure, recordedOutcome } from "@/lib/inngest/engine-callback";

/** When retries run out: the job is failed only if nothing of the result is linked. Exported for tests. */
export async function onDeepgramCallbackFailure({
    event,
    error,
}: {
    event: { data: { event: { data: DeepgramCallbackData } } };
    error: Error;
}): Promise<void> {
    const { transcriptId, jobId, requestId } = event.data.event.data;
    await onEngineCallbackFailure("deepgram", { transcriptId, jobId, requestId }, error);
}

export const handleDeepgramCallback = inngest.createFunction(
    {
        id: "handle-deepgram-callback",
        triggers: [{ event: deepgramCallbackTrigger }],
        retries: 4,
        // One callback per transcript at a time, like the result handler.
        concurrency: { limit: 1, key: "event.data.transcriptId" },
        onFailure: onDeepgramCallbackFailure,
    },
    async ({ event, step }) => {
        const { transcriptId, jobId, requestId, userId } = event.data;
        const exact = { transcriptId, jobId, requestId };
        const resultKey = getTranscriptionResultPath(userId, transcriptId, jobId);

        const checked = await step.run("check", async () => {
            const state = await readEngineCallbackState(createAdminClient(), "deepgram", exact);
            if (state.state === "not_ready") {
                throw new Error(`Job ${jobId} has not saved Deepgram request ${requestId} yet`);
            }
            return state;
        });

        if (checked.state === "gone") {
            // The route checks this after its upload too; this catches a delete
            // that landed after that check and before the delete route's sweep.
            await step.run("remove-orphaned-result", () =>
                removeTranscriptionResult(createAdminClient(), resultKey, "handleDeepgramCallback")
            );
            return { status: "forgotten", transcriptId, jobId };
        }
        if (checked.state === "stale") {
            console.log(`[inngest] Deepgram callback ${requestId} is stale; leaving it`);
            return { status: "stale", transcriptId, jobId };
        }
        if (checked.state === "handled") {
            return { status: "completed", transcriptId, jobId };
        }

        const recorded = await step.run("store-result", async () => {
            // The route stored the result at the job's own key; it is linked
            // and handed off from there, never uploaded again.
            const result = await recordEngineResult({
                supabase: createAdminClient(),
                engine: "deepgram",
                jobId,
                requestId,
                transcriptId,
                storedObjectKey: resultKey,
            });
            return recordedOutcome("deepgram", result);
        });

        if (recorded.state === "stale") {
            console.log(`[inngest] Deepgram request ${requestId} no longer matches job ${jobId}; leaving it`);
            return { status: "stale", transcriptId, jobId };
        }

        // A handoff counts once its receipt says so: recordEngineResult
        // tolerates a failed finalize, so it is confirmed here, in a step of
        // its own that retries without storing again.
        const attemptId = recorded.attemptId;
        if (attemptId) {
            await step.run("confirm-handoff", async () => {
                const completed = await confirmReceiptCompleted(createAdminClient(), "deepgram", requestId, attemptId);
                if (!completed) throw new Error(`Deepgram request ${requestId} was handed off by an attempt that has not finished`);
            });
        }

        return { status: "completed", transcriptId, jobId };
    }
);
