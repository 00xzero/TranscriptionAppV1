import { z } from 'zod'
import { TEXT_LIMITS } from './limits'
import { UuidSchema } from './primitives'
import { SavedTranscriptionOptionsSchema } from './transcription-options'

export const MAX_KEY_TERMS = 100
// A key term is a name or a short phrase; AssemblyAI takes at most six words
// per term, and longer ones read as spam rather than vocabulary for any engine.
export const MAX_KEY_TERM_WORDS = 6

// One key term, as the key-terms field and the create route both check it.
export const KeyTermSchema = z
  .string()
  .max(100, 'Key terms can be at most 100 characters.')
  .refine((term) => term.trim().split(/\s+/).filter(Boolean).length <= MAX_KEY_TERM_WORDS, {
    message: `Key terms can be at most ${MAX_KEY_TERM_WORDS} words.`,
  })

export const CreateTranscriptBodySchema = z.object({
  title: z.string().max(TEXT_LIMITS.transcriptTitle).optional(),
  filename: z.string().min(1, 'filename is required'),
  key_terms: z.array(KeyTermSchema).max(MAX_KEY_TERMS).optional(),
  // Client-generated, user-scoped upload idempotency key. Optional so the
  // file-upload path (no recording session) is unaffected. When present, the
  // server dedupes transcript creation by (user_id, upload_intent_id).
  upload_intent_id: z.string().min(1).max(200).optional(),
  project_id: UuidSchema.optional(),
  // Saved shape: a tab opened before the engine could be chosen sends no engine.
  transcription_options: SavedTranscriptionOptionsSchema.optional(),
})

export const CreateTranscriptWarningSchema = z.literal('project_missing')

export const DeleteProjectResponseSchema = z.object({
  deleted_projects: z.number().int().nonnegative(),
  deleted_transcripts: z.number().int().nonnegative(),
})

export const DeleteProjectErrorSchema = z.discriminatedUnion('stage', [
  z.object({
    error: z.string(),
    stage: z.literal('begin'),
    gone: z.literal(true).optional(),
  }),
  z.object({
    error: z.string(),
    stage: z.literal('storage'),
    removed_media: z.number().int().nonnegative(),
    removed_waveforms: z.number().int().nonnegative(),
    remaining_transcripts: z.number().int().nonnegative(),
  }),
  z.object({
    error: z.string(),
    stage: z.literal('finish'),
    gone: z.literal(true).optional(),
    remaining_transcripts: z.number().int().nonnegative().optional(),
  }),
])

export const DeleteTranscriptResponseSchema = z.object({
  deleted: z.literal(true),
})

// `gone` means the row no longer exists; its folder was still swept.
export const DeleteTranscriptErrorSchema = z.object({
  error: z.string(),
  gone: z.literal(true).optional(),
})

export type CreateTranscriptBody = z.infer<typeof CreateTranscriptBodySchema>
export type CreateTranscriptWarning = z.infer<typeof CreateTranscriptWarningSchema>
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
export type DeleteProjectError = z.infer<typeof DeleteProjectErrorSchema>
export type DeleteTranscriptResponse = z.infer<typeof DeleteTranscriptResponseSchema>
export type DeleteTranscriptError = z.infer<typeof DeleteTranscriptErrorSchema>
