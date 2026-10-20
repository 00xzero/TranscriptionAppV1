import { z } from 'zod'

// Soniox's async API (https://soniox.com/docs/api-reference), as far as we read
// it. Parsing keeps only the fields named here; the stored file keeps
// everything Soniox sent.

export const SonioxTranscriptionStatusSchema = z.enum(['queued', 'processing', 'completed', 'error'])

// A piece of a word: a word starts at a piece with leading whitespace (in
// languages written with spaces). Times are in milliseconds; translation
// tokens have none.
export const SonioxTokenSchema = z.object({
  text: z.string(),
  start_ms: z.number().optional(),
  end_ms: z.number().optional(),
  confidence: z.number(),
  speaker: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  is_audio_event: z.boolean().nullable().optional(),
  translation_status: z.enum(['none', 'original', 'translation']).nullable().optional(),
})

// GET /v1/transcriptions/{id}/transcript, served for completed jobs only.
export const SonioxTranscriptSchema = z.object({
  id: z.string(),
  text: z.string(),
  tokens: z.array(SonioxTokenSchema),
})

// GET /v1/transcriptions/{id}: the job, with its error when it failed.
export const SonioxTranscriptionSchema = z.object({
  id: z.string(),
  status: SonioxTranscriptionStatusSchema,
  model: z.string().optional(),
  audio_duration_ms: z.number().nullable().optional(),
  error_type: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
})

// POST /v1/transcriptions answers with the new job.
export const SonioxCreateResponseSchema = z.object({
  id: z.string().min(1),
})

// The webhook body: only the job's id and how it ended.
export const SonioxCallbackSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['completed', 'error']),
})

// The file kept in transcription-results for a Soniox job: both answers,
// each exactly as Soniox returned it.
export const SonioxStoredResultSchema = z.object({
  transcription: SonioxTranscriptionSchema,
  transcript: SonioxTranscriptSchema,
})

export type SonioxToken = z.infer<typeof SonioxTokenSchema>
export type SonioxTranscript = z.infer<typeof SonioxTranscriptSchema>
export type SonioxTranscription = z.infer<typeof SonioxTranscriptionSchema>
export type SonioxCallback = z.infer<typeof SonioxCallbackSchema>
export type SonioxStoredResult = z.infer<typeof SonioxStoredResultSchema>
