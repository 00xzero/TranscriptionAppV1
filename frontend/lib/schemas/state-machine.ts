import { z } from 'zod'
import { JobStatusSchema } from './db'

export const TransitionJobInputSchema = z.object({
  jobId: z.string().uuid('jobId must be a valid UUID'),
  to: JobStatusSchema,
  extraJobFields: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  context: z.string().optional(),
})
