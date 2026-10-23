/**
 * Handle a Soniox callback (passed on by app/api/webhooks/soniox).
 *
 * Soniox's callback carries only the job's id and status; the shared handler
 * (lib/inngest/fetching-engine-callback.ts) fetches, stores, hands off and only
 * then deletes it at Soniox. What is Soniox's own: the result stored is both of
 * its answers, `{ transcription, transcript }`, and a failure's reason is read
 * from the job alone, since the transcript endpoint serves completed jobs only.
 * The function and step ids are fixed: renaming one lets a run caught
 * mid-deploy repeat it.
 */

import {
    deleteSonioxTranscription,
    fetchSonioxTranscript,
    fetchSonioxTranscription,
} from "@/infra/soniox";
import { sonioxCallbackTrigger } from "@/lib/inngest/events";
import { createFetchingEngineCallback, onFetchingEngineCallbackFailure } from "@/lib/inngest/fetching-engine-callback";

/** When retries run out; Soniox's copy is never deleted here. Exported for tests. */
export const onSonioxCallbackFailure = onFetchingEngineCallbackFailure("soniox");

export const handleSonioxCallback = createFetchingEngineCallback({
    engine: "soniox",
    functionId: "handle-soniox-callback",
    trigger: sonioxCallbackTrigger,
    forgetStepId: "forget-at-soniox",
    fetchResult: async (requestId) => {
        const [transcription, transcript] = await Promise.all([
            fetchSonioxTranscription(requestId),
            fetchSonioxTranscript(requestId),
        ]);
        return JSON.stringify({ transcription: transcription.raw, transcript: transcript.raw });
    },
    fetchFailure: async (requestId) => {
        const { transcription } = await fetchSonioxTranscription(requestId);
        return {
            reason: transcription.error_message || transcription.error_type || null,
            detail: JSON.stringify({ error_type: transcription.error_type, error_message: transcription.error_message }),
        };
    },
    forget: deleteSonioxTranscription,
});
