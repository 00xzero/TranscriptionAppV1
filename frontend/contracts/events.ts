import { z } from 'zod'
import { UuidSchema } from './primitives'
import { SavedTranscriptionOptionsSchema } from './transcription-options'

export const TranscriptionRequestedDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema,
  userId: UuidSchema,
  keyTerms: z.array(z.string()).optional(),
  // Optional for events sent before the options existed: read it through
  // resolveTranscriptionOptions.
  transcriptionOptions: SavedTranscriptionOptionsSchema.optional(),
})

// Preparation forwards its payload unchanged to transcription/requested.
export const MediaPrepareRequestedDataSchema = TranscriptionRequestedDataSchema

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

// A Soniox job's callback, passed on by its route: the exact job attempt it
// belongs to (named in the callback URL) and how Soniox says it ended.
export const SonioxCallbackDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema,
  requestId: z.string().min(1),
  status: z.enum(['completed', 'error']),
})

// An AssemblyAI transcript's callback, passed on by its route: the exact job
// attempt it belongs to (named in the callback URL) and how AssemblyAI says it
// ended. The same shape as Soniox's.
export const AssemblyAICallbackDataSchema = SonioxCallbackDataSchema

// A Deepgram result, stored by its route at the job's own key and passed on:
// the exact job attempt (named in the request's extra), the request it
// answers, and the owner whose folder holds the file.
export const DeepgramCallbackDataSchema = z.object({
  transcriptId: UuidSchema,
  jobId: UuidSchema,
  requestId: z.string().min(1),
  userId: UuidSchema,
})

export const WaveformRequestedDataSchema = z.object({
  transcriptId: UuidSchema,
  userId: UuidSchema,
  sourceObjectKey: z.string().min(1),
})

export type TranscriptionRequestedData = z.infer<typeof TranscriptionRequestedDataSchema>
export type MediaPrepareRequestedData = z.infer<typeof MediaPrepareRequestedDataSchema>
export type TranscriptionWebhookData = z.infer<typeof TranscriptionWebhookDataSchema>
export type TranscriptionCompletedData = z.infer<typeof TranscriptionCompletedDataSchema>
export type TranscriptionFailedData = z.infer<typeof TranscriptionFailedDataSchema>
export type WaveformRequestedData = z.infer<typeof WaveformRequestedDataSchema>
export type SonioxCallbackData = z.infer<typeof SonioxCallbackDataSchema>
export type AssemblyAICallbackData = z.infer<typeof AssemblyAICallbackDataSchema>
export type DeepgramCallbackData = z.infer<typeof DeepgramCallbackDataSchema>
