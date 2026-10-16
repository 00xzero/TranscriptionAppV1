/**
 * Handle media preparation
 * Triggered by the start route before transcription. Probes the upload once,
 * then keeps it, copies the sound out of a video, or repacks oversized sound
 * (core/media/prepare-policy.ts). The prepared file replaces the original.
 * Then it asks for the transcription and the waveform.
 *
 * Preparation never blocks a transcript: when anything fails, the workflow
 * goes on with whichever file the row points at. Every job and row check runs
 * inside a step, so a replay after Deepgram has moved the job on does not stop
 * the waveform steps.
 */

import { inngest, sendInngestEvent } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { jobQueued } from "@/lib/inngest/job-checks";
import { mediaPrepareRequestedTrigger } from "@/lib/inngest/events";
import {
    claimWaveform,
    convertAndUpload,
    decide,
    linkPrepared,
    loadSource,
    preparedObjectKey,
    releaseWaveformClaim,
    removeOriginal,
    settleUnlinked,
} from "@/lib/media/prepare-steps";
import { writeTranscriptionFailureFallback } from "./_shared";

// Anything but a positive whole number falls back to 2.
const MEDIA_PREPARE_CONCURRENCY = (() => {
    const parsed = Number(process.env.MEDIA_PREPARE_CONCURRENCY);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
})();

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
        const { transcriptId, jobId, userId, keyTerms } = event.data;
        const ids = { transcriptId, jobId };

        const source = await step.run("load-source", () =>
            loadSource(createAdminClient(), { ...ids, userId })
        );
        if (!source.proceed) {
            console.log(`[inngest] Media preparation stopped for ${transcriptId}: ${source.reason}`);
            return { status: "stopped", reason: source.reason };
        }
        const sourceKey = source.sourceKey;
        const preparedKey = preparedObjectKey(userId, transcriptId, jobId);

        // The transcript now holds a file this run did not prepare: fail the
        // job now through the usual error path rather than leave it queued for
        // the timeout reaper.
        const failSuperseded = async () => {
            await step.sendEvent("fail-superseded", {
                name: "transcription/failed",
                id: `media-prepare-superseded:${jobId}`,
                data: {
                    transcriptId,
                    jobId,
                    error: "The transcript's media changed while it was being prepared",
                    errorType: "transcription_error",
                },
            });
            return { status: "stopped", reason: "superseded" } as const;
        };

        const { decision, probe } = await step.run("decide", () =>
            decide(createAdminClient(), sourceKey)
        );
        console.log(`[inngest] Media decision for ${transcriptId}: ${decision.action}${decision.action === "keep" ? ` (${decision.reason})` : ""}`);

        let preparedOutcome: "kept" | "prepared" | "fell_back" = "kept";
        if (decision.action !== "keep" && probe) {
            // Set when the prepared file's fate is uncertain: the row decides.
            let failure: string | null = null;
            let superseded = false;
            try {
                const converted = await step.run("convert-and-upload", () =>
                    convertAndUpload(createAdminClient(), { ...ids, sourceKey, preparedKey, probe, decision })
                );
                if (converted.outcome === "not_current") {
                    return { status: "stopped", reason: "job_not_current" };
                }
                if (converted.outcome === "rejected") {
                    preparedOutcome = "fell_back";
                    if (converted.mayHaveUploaded) failure = converted.reason;
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
                    preparedOutcome = "prepared";
                    console.error(`[inngest] Original cleanup failed for ${transcriptId} (${failure}); continuing with the prepared file`);
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
            data: { transcriptId, jobId, userId, keyTerms },
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
