import { z } from 'zod'
import { UuidSchema } from './primitives'

export const DeepgramWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  speaker: z.number().optional(),
})

export const DeepgramUtteranceSchema = z.object({
  start: z.number(),
  end: z.number(),
  transcript: z.string(),
  words: z.array(DeepgramWordSchema),
})

// For startAsyncTranscription() response (infra/deepgram/index.ts)
export const DeepgramAsyncResponseSchema = z.object({
  request_id: z.string(),
})

// For webhook callback payload — uses metadata.request_id, not top-level
// alternatives includes optional utterances (legacy position, handled by handle-transcription-webhook.ts:146)
export const DeepgramWebhookPayloadSchema = z.object({
  request_id: z.string().optional(), // top-level may be present but handler uses metadata.request_id
  metadata: z.object({
    request_id: z.string().min(1).optional(),
    duration: z.number().optional(),
    channels: z.number().optional(),
    models: z.array(z.string()).optional(),
    // extra is validated structurally: project_id must be a UUID when present
    extra: z.object({
      project_id: UuidSchema.optional(),
    }).catchall(z.string().optional()).optional(),
  }).optional(),
  results: z.object({
    channels: z.array(z.object({
      alternatives: z.array(z.object({
        transcript: z.string().optional(),
        words: z.array(DeepgramWordSchema).optional(),
        utterances: z.array(DeepgramUtteranceSchema).optional(), // legacy position
      })).optional(),
    })).optional(),
    utterances: z.array(DeepgramUtteranceSchema).optional(), // standard position
  }).optional(),
})

// Full receipt schema matching infra/supabase/migrations/20260321000000_webhook_receipts.sql
export const WebhookReceiptInsertSchema = z.object({
  provider: z.literal('deepgram'),
  request_id: z.string().min(1),
  project_id: UuidSchema.nullable().optional(),
  status: z.enum(['processing', 'completed', 'failed']).optional(),
  attempt_id: UuidSchema,
  claimed_at: z.string(),
  processed_at: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
  received_at: z.string().optional(),
})

// Re-export inferred types
export type DeepgramAsyncResponse = z.infer<typeof DeepgramAsyncResponseSchema>
export type DeepgramWebhookPayload = z.infer<typeof DeepgramWebhookPayloadSchema>
export type DeepgramWord = z.infer<typeof DeepgramWordSchema>
export type DeepgramUtterance = z.infer<typeof DeepgramUtteranceSchema>
