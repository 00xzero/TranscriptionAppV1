import { z } from 'zod'
import { JobStatusSchema } from './db'
import { uuidString } from './primitives'

export const TransitionJobInputSchema = z.object({
  jobId: uuidString('jobId must be a valid UUID'),
  to: JobStatusSchema,
  extraJobFields: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  context: z.string().optional(),
})
