import { z } from 'zod'

export const TranscriptionRequestedDataSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
  userId: z.string().uuid(),
  mediaUrl: z.string().url(),
  keyTerms: z.array(z.string()).optional(),
})

export const TranscriptionWebhookDataSchema = z.object({
  requestId: z.string(),
  projectId: z.string().uuid(),
})

export const TranscriptionCompletedDataSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
  duration: z.number(),
  chunkCount: z.number().optional(),
  chunkWordCount: z.number().optional(),
  algoVersion: z.string().optional(),
  consolidationError: z.string().nullable().optional(),
})

export const TranscriptionFailedDataSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
  error: z.string(),
  errorType: z.enum(['keyterm_error', 'transcription_error']),
})

export type TranscriptionRequestedData = z.infer<typeof TranscriptionRequestedDataSchema>
export type TranscriptionWebhookData = z.infer<typeof TranscriptionWebhookDataSchema>
export type TranscriptionCompletedData = z.infer<typeof TranscriptionCompletedDataSchema>
export type TranscriptionFailedData = z.infer<typeof TranscriptionFailedDataSchema>
