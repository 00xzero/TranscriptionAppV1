import { z } from 'zod'

export const CaptureUploadOutcomeSchema = z.enum(['started', 'saved_needs_retry', 'saved_status_unknown'])
export type CaptureUploadOutcome = z.infer<typeof CaptureUploadOutcomeSchema>
