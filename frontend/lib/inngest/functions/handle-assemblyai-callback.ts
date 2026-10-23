/**
 * Handle an AssemblyAI callback (passed on by app/api/webhooks/assemblyai).
 *
 * AssemblyAI's callback carries only the transcript's id and status; the
 * shared handler (lib/inngest/fetching-engine-callback.ts) fetches, stores,
 * hands off and only then deletes it at AssemblyAI. What is AssemblyAI's own:
 * the result stored is its transcript exactly as returned, and a failure's
 * reason is its `error`. The function and step ids are fixed: renaming one
 * lets a run caught mid-deploy repeat it.
 */

import { deleteAssemblyAITranscript, fetchAssemblyAITranscript } from "@/infra/assemblyai";
import { assemblyaiCallbackTrigger } from "@/lib/inngest/events";
import { createFetchingEngineCallback, onFetchingEngineCallbackFailure } from "@/lib/inngest/fetching-engine-callback";

/** When retries run out; AssemblyAI's copy is never deleted here. Exported for tests. */
export const onAssemblyAICallbackFailure = onFetchingEngineCallbackFailure("assemblyai");

export const handleAssemblyAICallback = createFetchingEngineCallback({
    engine: "assemblyai",
    functionId: "handle-assemblyai-callback",
    trigger: assemblyaiCallbackTrigger,
    forgetStepId: "forget-at-assemblyai",
    fetchResult: async (requestId) => {
        const { raw, transcript } = await fetchAssemblyAITranscript(requestId);
        // A transcript the callback called completed but is not would store nothing usable.
        if (transcript.status !== "completed") {
            throw new Error(`AssemblyAI transcript ${requestId} is ${transcript.status}, not completed`);
        }
        return JSON.stringify(raw);
    },
    fetchFailure: async (requestId) => {
        const { transcript } = await fetchAssemblyAITranscript(requestId);
        return {
            reason: transcript.error || null,
            detail: JSON.stringify({ status: transcript.status, error: transcript.error ?? null }),
        };
    },
    forget: deleteAssemblyAITranscript,
});
