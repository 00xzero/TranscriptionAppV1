/**
 * Handle media preparation
 * Triggered by the start route before transcription. Probes the upload once,
 * then keeps it, copies the sound out of a video, or repacks oversized sound
 * (core/media/prepare-policy.ts). The prepared file replaces the original.
 * Then it asks for the transcription and the waveform.
 *
 * Preparation never blocks a transcript: when probing or converting fails, the
 * workflow goes on with whichever file the row points at. Every job and row check runs
 * inside a step, so a replay after Deepgram has moved the job on does not stop
 * the waveform steps.
 */

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { jobQueued } from "@/lib/inngest/job-checks";
import { readPositiveIntEnv } from "@/lib/env";
import { mediaPrepareRequestedTrigger } from "@/lib/inngest/events";
import {
    claimWaveform,
    convertAndUpload,
    decide,
    type DecideResult,
    linkPrepared,
    loadSource,
    type LoadSourceResult,
    preparedObjectKey,
    releaseWaveformClaim,
    removeOriginal,
    settleUnlinked,
} from "@/lib/media/prepare-steps";
import { writeTranscriptionFailureFallback } from "./_shared";

const MEDIA_PREPARE_CONCURRENCY = readPositiveIntEnv("MEDIA_PREPARE_CONCURRENCY", 2);

export const handleMediaPrepare = inngest.createFunction(
    {
        id: "handle-media-prepare",
        triggers: [{ event: mediaPrepareRequestedTrigger }],
        // A 24-hour safeguard against a second run for the same job; the row
        // and job checks in every step are the lasting protection.
        idempotency: "event.data.jobId",
        concurrency: [
            { limit: 1, key: "event.data.transcriptId" },
            { limit: MEDIA_PREPARE_CONCURRENCY },
        ],
        retries: 2,
        onFailure: async ({ event, error }) => {
            const { transcriptId, jobId } = event.data.event.data;
            const errorMessage = error.message || String(error);
            console.error(`[inngest] Media preparation failed for transcript ${transcriptId}:`, errorMessage);
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
                        error_message: "Failed to start transcription. Please try again.",
                        error_type: "transcription_error",
                        error_detail: errorMessage.slice(0, 500),
                    },
                    context: "handleMediaPrepare/onFailure",
                });
            }
        },
    },
    async ({ event, step }) => {
        const { transcriptId, jobId, userId, keyTerms, transcriptionOptions } = event.data;
        const ids = { transcriptId, jobId };

        // Fail the job now through the usual error path rather than leave it
        // queued for the timeout reaper.
        const failJob = async (reason: "superseded" | "invalid_source", error: string) => {
            await step.sendEvent(`fail-${reason}`, {
                name: "transcription/failed",
                id: `media-prepare-${reason}:${jobId}`,
                data: { transcriptId, jobId, error, errorType: "transcription_error" },
            });
            return { status: "stopped", reason } as const;
        };

        // The source check is what keeps another user's file away from
        // Deepgram, so it is never skipped: if the job and row can't be read,
        // this throws and onFailure fails the job (nothing could go on to
        // Deepgram without them anyway). A file that can't be probed only
        // means nothing is prepared.
        const source: LoadSourceResult = await step.run("load-source", () =>
            loadSource(createAdminClient(), { ...ids, userId })
        );
        if (!source.proceed) {
            console.log(`[inngest] Media preparation stopped for ${transcriptId}: ${source.reason}`);
            if (source.reason === "invalid_source") {
                return await failJob("invalid_source", "The transcript's media does not belong to this request");
            }
            return { status: "stopped", reason: source.reason };
        }
        let sourceKey: string | null = null;
        if (source.skip) {
            // waveform_busy: an earlier job's waveform may still be reading
            // the original. waited_too_long: the job waited in line long
            // enough already; it goes on to Deepgram as it is.
            console.log(`[inngest] Keeping ${transcriptId}'s upload as it is: ${source.skip}`);
        } else {
            sourceKey = source.sourceKey;
        }
        const preparedKey = preparedObjectKey(userId, transcriptId, jobId);

        // The transcript now holds a file this run did not prepare.
        const failSuperseded = () =>
            failJob("superseded", "The transcript's media changed while it was being prepared");

        let decided: DecideResult | null = null;
        if (sourceKey !== null) {
            const key = sourceKey;
            try {
                decided = await step.run("decide", () => decide(createAdminClient(), key));
                const { decision } = decided;
                console.log(`[inngest] Media decision for ${transcriptId}: ${decision.action}${decision.action === "keep" ? ` (${decision.reason})` : ""}`);
            } catch (err) {
                console.warn(`[inngest] Could not decide on ${transcriptId}'s media; keeping it:`, err instanceof Error ? err.message : err);
            }
        }

        let preparedOutcome: "kept" | "prepared" | "fell_back" = "kept";
        if (sourceKey !== null && decided && decided.decision.action !== "keep" && decided.probe) {
            const decision = decided.decision;
            const probe = decided.probe;
            // Set when this run goes on without its prepared file: the row
            // decides which file the transcript keeps.
            let failure: string | null = null;
            let superseded = false;
            try {
                const converted = await step.run("convert-and-upload", () =>
                    convertAndUpload(createAdminClient(), { ...ids, sourceKey, preparedKey, probe, decision })
                );
                if (converted.outcome === "not_current") {
                    // An earlier attempt of the step may have uploaded the
                    // file: remove it unless the row points at it.
                    await step.run("reconcile-not-current", () =>
                        settleUnlinked(createAdminClient(), { transcriptId, sourceKey, preparedKey })
                    );
                    return { status: "stopped", reason: "job_not_current" };
                }
                if (converted.outcome === "rejected") {
                    // An earlier attempt of the step may have uploaded the
                    // file, so even a rejection is settled against the row.
                    failure = converted.reason;
                } else {
                    const linked = await step.run("link-prepared", () =>
                        linkPrepared(createAdminClient(), { ...ids, sourceKey, preparedKey })
                    );
                    if (linked.outcome === "superseded") {
                        superseded = true;
                    } else if (linked.outcome === "gone") {
                        return { status: "stopped", reason: "transcript_gone" };
                    } else if (linked.outcome === "not_current") {
                        return { status: "stopped", reason: "job_not_current" };
                    } else {
                        preparedOutcome = "prepared";
                        await step.run("remove-original", () =>
                            removeOriginal(createAdminClient(), { transcriptId, sourceKey, preparedKey })
                        );
                    }
                }
            } catch (err) {
                failure = err instanceof Error ? err.message : String(err);
            }

            if (superseded) return await failSuperseded();

            if (failure !== null) {
                // If the row can't be read this throws, and onFailure fails the job.
                const settled = await step.run("reconcile-after-failure", () =>
                    settleUnlinked(createAdminClient(), { transcriptId, sourceKey, preparedKey })
                );
                if (settled === "gone") return { status: "stopped", reason: "transcript_gone" };
                if (settled === "superseded") return await failSuperseded();
                if (settled === "prepared") {
                    // The swap landed but the original may still be stored:
                    // only one file is kept.
                    preparedOutcome = "prepared";
                    try {
                        await step.run("remove-original-after-failure", () =>
                            removeOriginal(createAdminClient(), { transcriptId, sourceKey, preparedKey })
                        );
                    } catch (cleanupError) {
                        console.error(`[inngest] Original cleanup failed for ${transcriptId} (${failure}); ${sourceKey} stays until the transcript is deleted:`, cleanupError);
                    }
                } else {
                    preparedOutcome = "fell_back";
                    console.warn(`[inngest] Media prepare failed for ${transcriptId} (${failure}), using original`);
                }
            }
        }

        const authorized = await step.run("authorize-transcription", () =>
            jobQueued(createAdminClient(), ids)
        );
        if (!authorized) {
            return { status: "stopped", reason: "job_not_current" };
        }
        await step.sendEvent("request-transcription", {
            name: "transcription/requested",
            id: `transcription-requested:${jobId}`,
            data: { transcriptId, jobId, userId, keyTerms, transcriptionOptions },
        });

        // The waveform is a UI enhancement: nothing here fails the run.
        try {
            const claim = await step.run("claim-waveform", () =>
                claimWaveform(createAdminClient(), ids)
            );
            if (claim.dispatch) {
                try {
                    await step.sendEvent("request-waveform", {
                        name: "waveform/requested",
                        id: `waveform:${transcriptId}:${claim.sourceObjectKey}`,
                        data: { transcriptId, userId, sourceObjectKey: claim.sourceObjectKey },
                    });
                } catch (sendError) {
                    console.error(`[inngest] Failed to dispatch waveform/requested for ${transcriptId}:`, sendError);
                    await step.run("release-waveform-claim", () =>
                        releaseWaveformClaim(createAdminClient(), transcriptId)
                    );
                }
            }
        } catch (waveformError) {
            console.error(`[inngest] Waveform dispatch failed for ${transcriptId} (non-fatal):`, waveformError);
        }

        return { status: "requested", transcriptId, jobId, media: preparedOutcome };
    }
);
