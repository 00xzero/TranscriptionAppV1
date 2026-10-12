import { z } from 'zod'
import { TranscriptSchema, SpeakerSchema } from '@/contracts/db'

// EditorWord: has computed key field not in the DB
export const EditorWordSchema = z.object({
  key: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
})

export const EditorTranscriptSchema = TranscriptSchema
export const EditorSpeakerSchema = SpeakerSchema

export type EditorWord = z.infer<typeof EditorWordSchema>
