import { z } from 'zod'
import { ProjectSchema, SpeakerSchema, SegmentSchema } from '@/contracts/db'

// EditorWord: has computed key field not in the DB
export const EditorWordSchema = z.object({
  key: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
})

// Editor transcript items are canonical segments with computed words.
export const EditorSegmentSchema = SegmentSchema.extend({
  words: z.array(EditorWordSchema).optional(),
})

export const EditorProjectSchema = ProjectSchema
export const EditorSpeakerSchema = SpeakerSchema

export type EditorWord = z.infer<typeof EditorWordSchema>
export type EditorSegment = z.infer<typeof EditorSegmentSchema>
