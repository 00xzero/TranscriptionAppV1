/**
 * Detect and mark stuck transcription jobs.
 * Runs on a schedule to fail jobs that have exceeded the timeout threshold.
 */

import { cron } from "inngest";
import { inngest } from "@/infra/inngest/client";
import { createAdminClient } from "@/infra/supabase/admin";
import { transitionJob } from "@/core/transcription/transition";

export const handleTranscriptionTimeouts = inngest.createFunction(
    {
        id: "handle-transcription-timeouts",
        triggers: [cron("*/10 * * * *")],
        concurrency: {
            limit: 1,
            key: '"transcription-timeouts"',
        },
    },
    async ({ step }) => {
        const timeoutMinutes = parseInt(
            process.env.TRANSCRIPTION_TIMEOUT_MINUTES || "45",
            10
        );
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const now = Date.now();
        const cutoffIso = new Date(now - timeoutMs).toISOString();

        const staleJobs = await step.run("find-stale-jobs", async () => {
            const supabase = createAdminClient();
            const { data: processingJobs, error: processingError } = await supabase
                .from("jobs")
                .select("id, transcript_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "processing")
                .lt("started_at", cutoffIso);

            if (processingError) {
                throw new Error(`Failed to load processing jobs for timeout check: ${processingError.message}`);
            }

            const { data: processingNoStartJobs, error: processingNoStartError } = await supabase
                .from("jobs")
                .select("id, transcript_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "processing")
                .is("started_at", null)
                .lt("created_at", cutoffIso);

            if (processingNoStartError) {
                throw new Error(`Failed to load processing jobs without start time: ${processingNoStartError.message}`);
            }

            const { data: queuedJobs, error: queuedError } = await supabase
                .from("jobs")
                .select("id, transcript_id, status, created_at, started_at")
                .in("type", ["transcription", "transcribe"])
                .eq("status", "queued")
                .lt("created_at", cutoffIso);

            if (queuedError) {
                throw new Error(`Failed to load queued jobs for timeout check: ${queuedError.message}`);
            }

            return [
                ...(processingJobs || []),
                ...(processingNoStartJobs || []),
                ...(queuedJobs || []),
            ];
        });

        if (staleJobs.length === 0) {
            return { timedOutJobs: 0, timeoutMinutes };
        }

        await step.run("mark-stale-jobs", async () => {
            const supabase = createAdminClient();
            const finishedAt = new Date().toISOString();
            const errorMessage = `Transcription timed out after ${timeoutMinutes} minutes. Please try again.`;
            const failures: { id: string; message: string }[] = [];

            for (const job of staleJobs) {
                try {
                    let currentPayload: Record<string, unknown> = {};
                    if (job.status === "processing") {
                        const { data: payloadRow, error: payloadError } = await supabase
                            .from("jobs")
                            .select("payload")
                            .eq("id", job.id)
                            .maybeSingle();
                        if (payloadError) {
                            throw new Error(`Failed to load payload for job ${job.id}: ${payloadError.message}`);
                        }
                        if (payloadRow?.payload && typeof payloadRow.payload === "object") {
                            currentPayload = payloadRow.payload as Record<string, unknown>;
                        }
                    }

                    const nextPayload = {
                        ...currentPayload,
                        error: errorMessage,
                        error_type: "transcription_error",
                        raw_error: "timeout",
                    };

                    // Transition via RPC (transcript status derived by trigger)
                    const { outcome, error: transitionError } = await transitionJob({
                        supabase,
                        jobId: job.id,
                        to: "error",
                        extraJobFields: {
                            finished_at: finishedAt,
                            payload: nextPayload,
                        },
                        metadata: { timeout_minutes: timeoutMinutes },
                        context: "handleTranscriptionTimeouts",
                    });

                    if (outcome === "noop" || outcome === "conflict") {
                        // Job was already handled by another process
                        console.log(`[inngest] Timeout: job ${job.id} already transitioned (${outcome}), skipping`);
                        continue;
                    }

                    if (outcome === "invalid") {
                        throw new Error(`Failed to timeout job ${job.id}: ${transitionError || "invalid transition"}`);
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    failures.push({ id: job.id, message });
                }
            }

            if (failures.length > 0) {
                const summary = failures
                    .map((failure) => `${failure.id}: ${failure.message}`)
                    .join("; ");
                throw new Error(`Failed to mark ${failures.length} job(s) as timed out: ${summary}`);
            }
        });

        return { timedOutJobs: staleJobs.length, timeoutMinutes };
    }
);
