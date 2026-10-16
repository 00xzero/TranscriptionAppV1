import { z } from 'zod'
import { JobStatusSchema } from './db'
import { uuidString } from './primitives'

// What a failed job records. Mirrors the jobs.error_* columns
// (infra/supabase/migrations/20261016000000_job_results_storage.sql).
export const JobErrorFieldsSchema = z.object({
  error_message: z.string(),
  error_type: z.string(),
  error_detail: z.string().max(500),
})

// The job columns a transition may set; transition_job_status refuses others.
export const ExtraJobFieldsSchema = JobErrorFieldsSchema.partial().extend({
  finished_at: z.string().optional(),
  started_at: z.string().optional(),
  // null keeps the stored value (COALESCE in transition_job_status).
  inngest_event_id: z.string().nullable().optional(),
}).strict()

export const TransitionJobInputSchema = z.object({
  jobId: uuidString('jobId must be a valid UUID'),
  to: JobStatusSchema,
  extraJobFields: ExtraJobFieldsSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  context: z.string().optional(),
})

export type JobErrorFields = z.infer<typeof JobErrorFieldsSchema>
export type ExtraJobFields = z.infer<typeof ExtraJobFieldsSchema>
