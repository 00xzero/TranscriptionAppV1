import { z } from 'zod'
import { ProjectSchema, SpeakerSchema, ChunkSchema, SegmentSchema } from './db'

// EditorWord: has computed key field not in the DB
export const EditorWordSchema = z.object({
  key: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
})

// Two raw item shapes from fetchTranscriptData() — validated against source flag
export const EditorChunkSchema = ChunkSchema.extend({
  words: z.array(EditorWordSchema).optional(),
})

export const EditorSegmentSchema = SegmentSchema.extend({
  words: z.array(EditorWordSchema).optional(),
})

export const EditorProjectSchema = ProjectSchema
export const EditorSpeakerSchema = SpeakerSchema

export type EditorWord = z.infer<typeof EditorWordSchema>
export type EditorChunk = z.infer<typeof EditorChunkSchema>
export type EditorSegment = z.infer<typeof EditorSegmentSchema>
