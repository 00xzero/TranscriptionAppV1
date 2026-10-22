import { z } from 'zod'

// AssemblyAI's pre-recorded API (https://www.assemblyai.com/docs/pre-recorded-audio),
// as far as we read it. Parsing keeps only the fields named here; the stored
// file keeps everything AssemblyAI sent.

export const AssemblyAIStatusSchema = z.enum(['queued', 'processing', 'completed', 'error'])

// A word with its times in milliseconds. `speaker` is "A", "B"… when speakers
// were asked for, and null otherwise.
export const AssemblyAIWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  speaker: z.string().nullable().optional(),
})

// GET /v2/transcript/{id}: the transcript, or its error. A failed one has no
// text or words, so both may be null and its `error` still reads.
export const AssemblyAITranscriptSchema = z.object({
  id: z.string(),
  status: AssemblyAIStatusSchema,
  error: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  words: z.array(AssemblyAIWordSchema).nullable().optional(),
  // The model that really transcribed it (Russian falls back to universal-2).
  speech_model_used: z.string().nullable().optional(),
  language_code: z.string().nullable().optional(),
  audio_duration: z.number().nullable().optional(),
})

// POST /v2/transcript answers with the new transcript.
export const AssemblyAICreateResponseSchema = z.object({
  id: z.string().min(1),
})

// The webhook body: only the transcript's id and how it ended.
export const AssemblyAICallbackSchema = z.object({
  transcript_id: z.string().min(1),
  status: z.enum(['completed', 'error']),
})

export type AssemblyAIWord = z.infer<typeof AssemblyAIWordSchema>
export type AssemblyAITranscript = z.infer<typeof AssemblyAITranscriptSchema>
export type AssemblyAICallback = z.infer<typeof AssemblyAICallbackSchema>
