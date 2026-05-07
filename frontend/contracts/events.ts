import { z } from 'zod'
import { UuidSchema } from './primitives'

export const TranscriptionRequestedDataSchema = z.object({
  projectId: UuidSchema,
  jobId: UuidSchema,
  userId: UuidSchema,
  mediaUrl: z.url(),
  keyTerms: z.array(z.string()).optional(),
})

export const TranscriptionWebhookDataSchema = z.object({
  requestId: z.string(),
  projectId: UuidSchema,
})

export const TranscriptionCompletedDataSchema = z.object({
  projectId: UuidSchema,
  jobId: UuidSchema,
  duration: z.number(),
})

export const TranscriptionFailedDataSchema = z.object({
  projectId: UuidSchema,
  jobId: UuidSchema.optional(),
  error: z.string(),
  errorType: z.enum(['keyterm_error', 'transcription_error']),
})

export type TranscriptionRequestedData = z.infer<typeof TranscriptionRequestedDataSchema>
export type TranscriptionWebhookData = z.infer<typeof TranscriptionWebhookDataSchema>
export type TranscriptionCompletedData = z.infer<typeof TranscriptionCompletedDataSchema>
export type TranscriptionFailedData = z.infer<typeof TranscriptionFailedDataSchema>
