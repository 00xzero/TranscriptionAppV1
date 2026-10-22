/**
 * The callback handler of an engine whose callback carries only its job's id
 * and status (Soniox, AssemblyAI): the result is fetched here, stored like any
 * engine's (recordEngineResult), handed off to transcription/webhook, and only
 * then deleted at the engine, which otherwise keeps it for 30 days. Our own
 * records are read first, so a replayed or late callback fetches nothing. The
 * engine's copy is never deleted before ours is safe: when retries run out it
 * stays there, retrievable, until the engine's own retention ends. A stale
 * callback keeps it too when its attempt failed (it may be wanted to recover
 * the transcript); only an orphaned start, whose job another request replaced,
 * is deleted straight away, since nothing of ours will ever read it.
 */

import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { confirmReceiptCompleted, persistWebhookFailure, recordEngineResult } from "@/core/transcription/webhook";
import { TRANSCRIPTION_ENGINE_BRANDS, type TranscriptionEngine } from "@/contracts/transcription-options";
import type { SonioxCallbackData } from "@/contracts/events";
import { assemblyaiCallbackTrigger, sonioxCallbackTrigger } from "@/lib/inngest/events";
import { readEngineCallbackState } from "@/lib/inngest/engine-callback-state";
import { onEngineCallbackFailure, recordedOutcome } from "@/lib/inngest/engine-callback";

/** What a fetching engine's callback carries; the same for every such engine. */
export type FetchingEngineCallbackData = SonioxCallbackData;

/** What the shared handler needs from an engine whose result it fetches. */
export interface FetchingEngine {
    engine: TranscriptionEngine;
    /** The Inngest function's id; fixed once deployed, like its step ids. */
    functionId: string;
    trigger: typeof sonioxCallbackTrigger | typeof assemblyaiCallbackTrigger;
    /** The cleanup step's id, named for the engine. */
    forgetStepId: string;
    /** The result to store: the engine's answer, exactly as it sent it. */
    fetchResult(requestId: string): Promise<string>;
    /** Why the engine says the job failed, and its own record of the failure. */
    fetchFailure(requestId: string): Promise<{ reason: string | null; detail: string }>;
    /** Delete the job at the engine; one already gone counts as deleted. */
    forget(requestId: string): Promise<void>;
}

/**
 * When retries run out. The engine's copy is never deleted here: before the
 * handoff it is the only copy, and after it only cleanup failed.
 */
export function onFetchingEngineCallbackFailure(engine: TranscriptionEngine) {
    return async ({
        event,
        error,
    }: {
        event: { data: { event: { data: FetchingEngineCallbackData } } };
        error: Error;
    }): Promise<void> => {
        const { transcriptId, jobId, requestId } = event.data.event.data;
        await onEngineCallbackFailure(engine, { transcriptId, jobId, requestId }, error);
    };
}

export function createFetchingEngineCallback(source: FetchingEngine) {
    const { engine } = source;
    const brand = TRANSCRIPTION_ENGINE_BRANDS[engine];

    return inngest.createFunction(
        {
            id: source.functionId,
            triggers: [{ event: source.trigger }],
            retries: 4,
            // One callback per transcript at a time, like the result handler.
            concurrency: { limit: 1, key: "event.data.transcriptId" },
            onFailure: onFetchingEngineCallbackFailure(engine),
        },
        async ({ event, step }) => {
            const { transcriptId, jobId, requestId, status } = event.data as FetchingEngineCallbackData;
            const exact = { transcriptId, jobId, requestId };

            const checked = await step.run("check", async () => {
                const state = await readEngineCallbackState(createAdminClient(), engine, exact);
                if (state.state === "not_ready") {
                    throw new Error(`Job ${jobId} has not saved ${brand} request ${requestId} yet`);
                }
                return state;
            });

            // A failed or missing attempt keeps the engine's copy, retrievable;
            // only an orphaned start (another request replaced it) is deleted there.
            if (checked.state === "stale" && !checked.otherRequest) {
                console.log(`[inngest] ${brand} callback ${requestId} is stale; leaving it`);
                return { status: "stale", transcriptId, jobId };
            }
            const orphaned = checked.state === "stale";
            if (orphaned) console.log(`[inngest] ${brand} request ${requestId} was replaced on job ${jobId}; forgetting it at ${brand}`);

            if (checked.state === "fresh" || checked.state === "stored") {
                const recorded = status === "completed"
                    ? await step.run("store-result", async () => {
                        const supabase = createAdminClient();
                        // Read again here, not from the saved check: a retry of
                        // this step replays that check, but an earlier try may
                        // have stored and linked our copy since, and that copy is
                        // resumed without fetching from the engine again.
                        const now = await readEngineCallbackState(supabase, engine, exact);
                        if (now.state === "handled") return { state: "recorded" as const, attemptId: null };
                        if (now.state === "stale" || now.state === "gone") return { state: "stale" as const, attemptId: null };
                        if (now.state === "not_ready") {
                            throw new Error(`Job ${jobId} has not saved ${brand} request ${requestId} yet`);
                        }
                        // Resume from our own copy, already stored and linked,
                        // without storing it again; the transcript is never
                        // passed through a step's return value.
                        const stored = now.state === "stored"
                            ? { storedObjectKey: now.resultObjectKey }
                            : { rawBody: await source.fetchResult(requestId) };
                        const result = await recordEngineResult({
                            supabase,
                            engine,
                            jobId,
                            requestId,
                            transcriptId,
                            ...stored,
                        });
                        return recordedOutcome(engine, result);
                    })
                    : await step.run("record-failure", async () => {
                        const { reason, detail } = await source.fetchFailure(requestId);
                        const message = reason || `${brand} could not transcribe the audio`;
                        const failed = await persistWebhookFailure({
                            supabase: createAdminClient(),
                            engine,
                            jobId,
                            transcriptId,
                            requestId,
                            message: `Transcription failed: ${message.slice(0, 200)}`,
                            detail,
                        });
                        if (failed === "job") return { state: "recorded" as const, attemptId: null };
                        if (failed === "stale") return { state: "stale" as const, attemptId: null };
                        throw new Error(`Could not record ${brand}'s failure for job ${jobId} yet`);
                    });

                if (recorded.state === "stale") {
                    // Why it changed is unknown here, so the engine's copy is kept.
                    console.log(`[inngest] ${brand} job ${requestId} no longer matches job ${jobId}; leaving it`);
                    return { status: "stale", transcriptId, jobId };
                }

                // A handoff counts once its receipt says so: recordEngineResult
                // tolerates a failed finalize, so it is confirmed here, in a
                // step of its own that retries without storing again.
                const attemptId = recorded.attemptId;
                if (attemptId) {
                    await step.run("confirm-handoff", async () => {
                        const completed = await confirmReceiptCompleted(createAdminClient(), engine, requestId, attemptId);
                        if (!completed) throw new Error(`${brand} request ${requestId} was handed off by an attempt that has not finished`);
                    });
                }
            }

            // Ours is safe (stored and handed off, or the failure recorded), the
            // transcript is gone, or the start was orphaned: the engine's copy can go.
            await step.run(source.forgetStepId, () => source.forget(requestId));

            return { status: orphaned ? "stale" : checked.state === "gone" ? "forgotten" : status, transcriptId, jobId };
        }
    );
}
