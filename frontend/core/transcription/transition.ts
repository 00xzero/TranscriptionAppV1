/**
 * Job Status Transition Layer
 *
 * Centralized functions for transitioning job status via the
 * `transition_job_status` RPC. Handles idempotency, conflict
 * detection, and audit logging.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobStatus } from "@/core/transcription/machine";
import { TransitionJobInputSchema } from "@/contracts/state-machine";

export interface TransitionJobResult {
  outcome: "applied" | "noop" | "conflict" | "invalid";
  previousStatus?: JobStatus;
  error?: string;
}

export async function transitionJob(opts: {
  supabase: SupabaseClient;
  jobId: string;
  to: JobStatus;
  extraJobFields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: string;
}): Promise<TransitionJobResult> {
  const parsed = TransitionJobInputSchema.safeParse({
    jobId: opts.jobId,
    to: opts.to,
    extraJobFields: opts.extraJobFields,
    metadata: opts.metadata,
    context: opts.context,
  })
  if (!parsed.success) {
    return { outcome: 'invalid' as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { supabase, jobId, to, extraJobFields, metadata, context } = opts;

  const { data, error } = await supabase.rpc("transition_job_status", {
    p_job_id: jobId,
    p_to_status: to,
    p_extra_fields: extraJobFields ?? {},
    p_metadata: metadata ?? {},
    p_context: context ?? null,
  });

  if (error) {
    return { outcome: "invalid", error: error.message };
  }

  const result = data as { outcome: string; previous_status?: string; error?: string };

  if (result.outcome === "conflict") {
    // Re-read: if already at target, it's a benign replay
    const { data: job } = await supabase
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (job?.status === to) {
      return { outcome: "noop", previousStatus: result.previous_status as JobStatus };
    }
    return { outcome: "conflict", previousStatus: result.previous_status as JobStatus };
  }

  return {
    outcome: result.outcome as TransitionJobResult["outcome"],
    previousStatus: result.previous_status as JobStatus | undefined,
    error: result.error,
  };
}

/**
 * Force a job to error status — degraded-path only.
 * Guards against overwriting terminal success (completed).
 * Never throws.
 */
export async function forceJobError(opts: {
  supabase: SupabaseClient;
  jobId: string;
  extraJobFields?: Record<string, unknown>;
  context?: string;
}): Promise<void> {
  try {
    const { supabase, jobId, extraJobFields, context } = opts;
    const now = new Date().toISOString();

    const updateFields: Record<string, unknown> = {
      status: "error",
      finished_at: extraJobFields?.finished_at ?? now,
      updated_at: now,
    };

    if (extraJobFields?.payload !== undefined) {
      updateFields.payload = extraJobFields.payload;
    }

    const { error } = await supabase
      .from("jobs")
      .update(updateFields)
      .eq("id", jobId)
      .in("status", ["queued", "processing"]);

    if (error) {
      console.error(`[forceJobError] Failed to force error for job ${jobId} (${context}):`, error);
    }
  } catch (err) {
    console.error(`[forceJobError] Unexpected error (${opts.context}):`, err);
  }
}
