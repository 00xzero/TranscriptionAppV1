/**
 * Transcription State Machine
 *
 * Pure logic for job/transcript status transitions — zero I/O.
 * The single source of truth for valid states and transitions.
 */

import { z } from 'zod'
import { JobStatusSchema, TranscriptStatusSchema } from '@/contracts/db'

export type JobStatus = z.infer<typeof JobStatusSchema>
export type TranscriptStatus = z.infer<typeof TranscriptStatusSchema>

export type TransitionOutcome = "applied" | "noop" | "conflict" | "invalid";

const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  // A successful webhook can arrive before the request handler marks the job
  // as processing, or after a local timeout has already marked it as error.
  queued: ["processing", "completed", "error"],
  processing: ["completed", "error"],
  completed: [],
  error: ["completed"],
};

const JOB_STATUSES: Set<string> = new Set(["queued", "processing", "completed", "error"]);
const TRANSCRIPT_STATUSES: Set<string> = new Set(["created", "queued", "processing", "completed", "error"]);
const TERMINAL_JOB_STATUSES: Set<string> = new Set(["completed", "error"]);

export function isJobStatus(s: string): s is JobStatus {
  return JOB_STATUSES.has(s);
}

export function isTranscriptStatus(s: string): s is TranscriptStatus {
  return TRANSCRIPT_STATUSES.has(s);
}

export function isTerminalJobStatus(s: string): s is "completed" | "error" {
  return TERMINAL_JOB_STATUSES.has(s);
}

export function validateJobTransition(opts: {
  from: JobStatus;
  to: JobStatus;
  jobId?: string;
}): { outcome: "applied" | "noop" | "invalid"; reason?: string } {
  if (opts.from === opts.to) {
    return { outcome: "noop" };
  }

  const validTargets = VALID_JOB_TRANSITIONS[opts.from];
  if (validTargets.includes(opts.to)) {
    return { outcome: "applied" };
  }

  return {
    outcome: "invalid",
    reason: `Invalid transition: ${opts.from} -> ${opts.to}${opts.jobId ? ` (job ${opts.jobId})` : ""}`,
  };
}

export function deriveTranscriptStatus(jobStatuses: JobStatus[]): TranscriptStatus {
  if (jobStatuses.length === 0) {
    return "created";
  }

  if (jobStatuses.some((s) => s === "processing")) {
    return "processing";
  }

  if (jobStatuses.some((s) => s === "queued")) {
    return "queued";
  }

  // All terminal — return the newest (last in array, caller orders by created_at)
  return jobStatuses[jobStatuses.length - 1] as TranscriptStatus;
}
