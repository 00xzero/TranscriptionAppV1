/**
 * Where an engine's callback stands against our own records, read before any
 * fetch or write: a duplicate long after Inngest's 24-hour deduplication must
 * not fetch, write or fail anything. The writes repeat their own checks
 * (core/transcription/webhook.ts), since state can change after this read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptionEngine } from "@/contracts/transcription-options";

export type EngineCallbackState =
    /** The transcript was deleted here: nothing is left to keep the result for. */
    | { state: "gone" }
    /** The result was stored and handed off already (or the job finished): only cleanup is left. */
    | { state: "handled" }
    /** Our copy is stored and linked but was never handed off: resume from it. */
    | { state: "stored"; resultObjectKey: string }
    /** Nothing recorded yet: fetch from Soniox. */
    | { state: "fresh" }
    /**
     * The attempt failed, or belongs to another request: touch nothing of ours.
     * `otherRequest`: the job carries another request of the engine's, so this
     * one is an orphaned start nothing will ever read (Soniox deletes only its
     * copy of that one; a failed or missing job's copy is kept, retrievable).
     */
    | { state: "stale"; otherRequest: boolean }
    /** The start has not saved the request id yet: try again shortly. */
    | { state: "not_ready" };

export async function readEngineCallbackState(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    { transcriptId, jobId, requestId }: { transcriptId: string; jobId: string; requestId: string }
): Promise<EngineCallbackState> {
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("transcript_id, status, inngest_event_id, result_object_key")
        .eq("id", jobId)
        .maybeSingle();
    if (jobError) throw new Error(`Failed to read job ${jobId}: ${jobError.message}`);

    if (!job) {
        const { data: transcript, error: transcriptError } = await supabase
            .from("transcripts")
            .select("id")
            .eq("id", transcriptId)
            .maybeSingle();
        if (transcriptError) throw new Error(`Failed to read transcript ${transcriptId}: ${transcriptError.message}`);
        return transcript ? { state: "stale", otherRequest: false } : { state: "gone" };
    }

    if (job.transcript_id !== transcriptId) return { state: "stale", otherRequest: false };
    if (job.inngest_event_id && job.inngest_event_id !== requestId) return { state: "stale", otherRequest: true };

    const { data: receipt, error: receiptError } = await supabase
        .from("webhook_receipts")
        .select("status")
        .eq("provider", engine)
        .eq("request_id", requestId)
        .maybeSingle();
    if (receiptError) throw new Error(`Failed to read receipt ${requestId}: ${receiptError.message}`);

    if (receipt?.status === "completed" || job.status === "completed") return { state: "handled" };
    if (job.status === "error") return { state: "stale", otherRequest: false };
    if (job.status === "queued") return { state: "not_ready" };
    // Linked before the handoff, so a linked file alone is not "handled".
    if (job.result_object_key) return { state: "stored", resultObjectKey: job.result_object_key };
    return { state: "fresh" };
}

/**
 * After retries ran out, how far did this callback get?
 * - `handedOff`: the result was handed off (receipt completed), the job is
 *   already finished, or the job runs another request (this one was an
 *   orphaned start): only cleanup failed.
 * - `resultLinked`: our copy is linked but the handoff is not confirmed: the
 *   event may well have gone out and the job may still be processing, so it
 *   must not be failed; the timeout reaper settles it if nothing does.
 * - `jobExists`: a record of the failure can only point at rows that exist.
 * Throws when the state cannot be read, so the failure handler retries rather
 * than guess.
 */
export async function engineHandoffState(
    supabase: SupabaseClient,
    engine: TranscriptionEngine,
    { jobId, requestId }: { jobId: string; requestId: string }
): Promise<{ handedOff: boolean; resultLinked: boolean; jobExists: boolean }> {
    const [{ data: job, error: jobError }, { data: receipt, error: receiptError }] = await Promise.all([
        supabase.from("jobs").select("status, result_object_key, inngest_event_id").eq("id", jobId).maybeSingle(),
        supabase
            .from("webhook_receipts")
            .select("status")
            .eq("provider", engine)
            .eq("request_id", requestId)
            .maybeSingle(),
    ]);
    if (jobError || receiptError) {
        throw new Error(`Failed to read the ${engine} callback's state: ${(jobError ?? receiptError)?.message}`);
    }
    // A job running another request (this one was an orphaned start) is not
    // this callback's to fail: its own request reports for it.
    const otherRequest = !!job?.inngest_event_id && job.inngest_event_id !== requestId;
    const handedOff =
        receipt?.status === "completed" ||
        otherRequest ||
        // A job that is gone or already finished has nothing left to fail.
        !job || job.status === "completed" || job.status === "error";
    return { handedOff, resultLinked: !otherRequest && !!job?.result_object_key, jobExists: !!job };
}
