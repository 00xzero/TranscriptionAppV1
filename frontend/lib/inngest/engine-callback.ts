/**
 * What every engine's callback handler shares once the engine's result is in
 * hand (handle-soniox-callback, handle-deepgram-callback): how storing it is
 * read, how long a held receipt is waited out, and what running out of retries
 * does. Our state is read through lib/inngest/engine-callback-state.ts.
 */

import { RetryAfterError } from "inngest";

import { sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import type { WebhookHandleResult } from "@/core/transcription/webhook";
import { TRANSCRIPTION_ENGINE_BRANDS, type TranscriptionEngine } from "@/contracts/transcription-options";
import { engineHandoffState } from "@/lib/inngest/engine-callback-state";
import { writeTranscriptionFailureFallback } from "@/lib/inngest/functions/_shared";

// Past a held receipt lease, so the retry finds it lapsed.
const LEASE_MARGIN_MS = 5_000;

/**
 * How long a retry waits when storing was refused for now: past the lease of an
 * attempt that still holds the receipt, and never less than the usual delay.
 */
export function receiptRetryDelayMs(result: { retryAfter: number; leaseRemainingMs?: number }): number {
    return Math.max(result.retryAfter * 1000, (result.leaseRemainingMs ?? 0) + LEASE_MARGIN_MS);
}

/**
 * What storing the result came to, inside the step that stored it: recorded
 * (with the attempt whose handoff is still to be confirmed, when it was this
 * one) or stale. Throws so the step retries: an error at once, and a receipt
 * another attempt holds (most likely one killed mid-step) only once its lease
 * has lapsed, instead of using up the attempts on Inngest's quicker schedule.
 */
export function recordedOutcome(
    engine: TranscriptionEngine,
    result: WebhookHandleResult & { attemptId?: string }
): { state: "recorded" | "stale"; attemptId: string | null } {
    const brand = TRANSCRIPTION_ENGINE_BRANDS[engine];
    switch (result.outcome) {
        case "processed": return { state: "recorded", attemptId: result.attemptId ?? null };
        case "duplicate": return { state: "recorded", attemptId: null };
        case "stale": return { state: "stale", attemptId: null };
        case "error": throw new Error(`Storing the ${brand} result failed: ${result.reason}`);
        case "retrying":
            throw new RetryAfterError(
                `The ${brand} result is being stored by another delivery`,
                receiptRetryDelayMs(result)
            );
    }
}

/**
 * When a callback handler's retries run out. Nothing is deleted at the engine
 * here. The job is failed only when nothing of the result reached us; a state
 * that cannot be read throws, so the failure handler is retried rather than
 * guess.
 */
export async function onEngineCallbackFailure(
    engine: TranscriptionEngine,
    { transcriptId, jobId, requestId }: { transcriptId: string; jobId: string; requestId: string },
    error: Error
): Promise<void> {
    const errorMessage = error.message || String(error);
    const supabase = createAdminClient();

    // Throws when unreadable: the failure handler is retried.
    const handoff = await engineHandoffState(supabase, engine, { jobId, requestId });

    // Either the handoff happened (only cleanup failed) or our copy is linked
    // and the handoff may have happened: the transcription may still be
    // processing, so its status is left alone. The timeout reaper settles a
    // job that really was left behind.
    if (handoff.handedOff || handoff.resultLinked) {
        const eventName = handoff.handedOff ? `${engine}/cleanup_failure` : `${engine}/handoff_unconfirmed`;
        console.error(`[inngest] ${eventName} for ${requestId}:`, errorMessage);
        const { error: insertError } = await supabase.from("failed_events").insert({
            event_name: eventName,
            event_data: { transcriptId, jobId, requestId },
            error_message: errorMessage.slice(0, 1000),
            transcript_id: handoff.jobExists ? transcriptId : null,
            job_id: handoff.jobExists ? jobId : null,
        });
        if (insertError) console.error(`[inngest] Failed to record ${eventName}:`, insertError);
        return;
    }

    console.error(`[inngest] ${TRANSCRIPTION_ENGINE_BRANDS[engine]} callback failed for transcript ${transcriptId}:`, errorMessage);
    try {
        await sendInngestEvent({
            name: "transcription/failed",
            data: { transcriptId, jobId, error: errorMessage, errorType: "transcription_error" },
        });
    } catch (sendError) {
        console.error("[inngest] Failed to emit transcription/failed:", sendError);
        await writeTranscriptionFailureFallback({
            transcriptId,
            jobId,
            error: {
                error_message: `Transcription failed: ${errorMessage.slice(0, 200)}`,
                error_type: "transcription_error",
                error_detail: errorMessage.slice(0, 500),
            },
            context: `handle${TRANSCRIPTION_ENGINE_BRANDS[engine]}Callback/onFailure`,
        });
    }
}
