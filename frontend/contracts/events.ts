import { z } from 'zod'
import { UuidSchema } from './primitives'

export const TranscriptionRequestedDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema,
  userId: UuidSchema,
  mediaUrl: z.url(),
  keyTerms: z.array(z.string()).optional(),
})

export const TranscriptionWebhookDataSchema = z.object({
  requestId: z.string(),
  transcriptId: UuidSchema,
})

export const TranscriptionCompletedDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema,
  duration: z.number(),
})

export const TranscriptionFailedDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema.optional(),
  error: z.string(),
  errorType: z.enum(['keyterm_error', 'transcription_error']),
})

export const WaveformRequestedDataSchema = z.object({
  transcriptId: UuidSchema,
  userId: UuidSchema,
  sourceObjectKey: z.string().min(1),
})

export type TranscriptionRequestedData = z.infer<typeof TranscriptionRequestedDataSchema>
export type TranscriptionWebhookData = z.infer<typeof TranscriptionWebhookDataSchema>
export type TranscriptionCompletedData = z.infer<typeof TranscriptionCompletedDataSchema>
export type TranscriptionFailedData = z.infer<typeof TranscriptionFailedDataSchema>
export type WaveformRequestedData = z.infer<typeof WaveformRequestedDataSchema>
