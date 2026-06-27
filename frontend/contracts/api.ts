import { z } from 'zod'

export const CreateProjectBodySchema = z.object({
  title: z.string().max(500).optional(),
  filename: z.string().min(1, 'filename is required'),
  key_terms: z.array(z.string().max(100)).max(100).optional(),
  // Client-generated, user-scoped upload idempotency key. Optional so the
  // file-upload path (no recording session) is unaffected. When present, the
  // server dedupes project creation by (user_id, upload_intent_id).
  upload_intent_id: z.string().min(1).max(200).optional(),
})

export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>
