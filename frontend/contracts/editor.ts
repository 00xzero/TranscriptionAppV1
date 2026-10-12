import { z } from 'zod'
import { TranscriptSchema, SpeakerSchema, WordSchema } from '@/contracts/db'

// A stored Deepgram word as the editor loads it: the columns needed to line
// segment text up against the audio. Rows with impossible timing are rejected.
export const EditorSourceWordSchema = WordSchema.pick({
  id: true,
  segment_id: true,
  start_ms: true,
  end_ms: true,
  text: true,
  punctuated_text: true,
  order_index: true,
}).refine((word) => word.start_ms >= 0 && word.end_ms >= word.start_ms, {
  message: 'word timing must satisfy 0 <= start_ms <= end_ms',
})

export const EditorTranscriptSchema = TranscriptSchema
export const EditorSpeakerSchema = SpeakerSchema

export type EditorSourceWord = z.infer<typeof EditorSourceWordSchema>
