/**
 * Where a Soniox callback stands against our own records, read before any
 * fetch: a duplicate long after Inngest's 24-hour deduplication must not fetch,
 * write or fail anything. The writes repeat their own checks
 * (core/transcription/webhook.ts), since state can change after this read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SonioxCallbackState =
    /** The transcript was deleted here: nothing is left to keep Soniox's copy for. */
    | { state: "gone" }
    /** The result was stored and handed off already (or the job finished): only cleanup is left. */
    | { state: "handled" }
    /** Our copy is stored and linked but was never handed off: resume from it. */
    | { state: "stored"; resultObjectKey: string }
    /** Nothing recorded yet: fetch from Soniox. */
    | { state: "fresh" }
    /**
     * The attempt failed, or belongs to another request: touch nothing of ours.
     * `otherRequest`: the job carries another Soniox request, so this one is
     * an orphaned start nothing will ever read, and only it is deleted at
     * Soniox. Otherwise (a failed or missing job) Soniox's copy is kept,
     * retrievable, until its 30 days are up.
     */
    | { state: "stale"; otherRequest: boolean }
    /** The start has not saved the request id yet: try again shortly. */
    | { state: "not_ready" };

export async function readSonioxCallbackState(
    supabase: SupabaseClient,
    { transcriptId, jobId, requestId }: { transcriptId: string; jobId: string; requestId: string }
): Promise<SonioxCallbackState> {
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
        .eq("provider", "soniox")
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
 * - `handedOff`: the result was handed off (receipt completed) or the job is
 *   already finished: only cleanup failed.
 * - `resultLinked`: our copy is linked but the handoff is not confirmed: the
 *   event may well have gone out and the job may still be processing, so it
 *   must not be failed; the timeout reaper settles it if nothing does.
 * - `jobExists`: a record of the failure can only point at rows that exist.
 * Throws when the state cannot be read, so the failure handler retries rather
 * than guess.
 */
export async function sonioxHandoffState(
    supabase: SupabaseClient,
    { jobId, requestId }: { jobId: string; requestId: string }
): Promise<{ handedOff: boolean; resultLinked: boolean; jobExists: boolean }> {
    const [{ data: job, error: jobError }, { data: receipt, error: receiptError }] = await Promise.all([
        supabase.from("jobs").select("status, result_object_key").eq("id", jobId).maybeSingle(),
        supabase
            .from("webhook_receipts")
            .select("status")
            .eq("provider", "soniox")
            .eq("request_id", requestId)
            .maybeSingle(),
    ]);
    if (jobError || receiptError) {
        throw new Error(`Failed to read the Soniox callback's state: ${(jobError ?? receiptError)?.message}`);
    }
    const handedOff =
        receipt?.status === "completed" ||
        // A job that is gone or already finished has nothing left to fail.
        !job || job.status === "completed" || job.status === "error";
    return { handedOff, resultLinked: !!job?.result_object_key, jobExists: !!job };
}
