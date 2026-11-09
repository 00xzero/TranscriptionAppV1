import { z } from 'zod'
import { TranscriptSchema, SpeakerSchema, WordSchema } from '@/contracts/db'

// A stored Deepgram word as the editor loads it: the columns needed to line
// segment text up against the audio. Rows with impossible timing are rejected.
const EditorWordFields = WordSchema.pick({
  id: true,
  start_ms: true,
  end_ms: true,
  text: true,
  punctuated_text: true,
  order_index: true,
})
const validTiming = (word: z.infer<typeof EditorWordFields>) => word.start_ms >= 0 && word.end_ms >= word.start_ms
const timingError = {
  message: 'word timing must satisfy 0 <= start_ms <= end_ms',
}
export const EditorEmbeddedWordSchema = EditorWordFields.refine(validTiming, timingError)
export const EditorSourceWordSchema = EditorWordFields.extend({ segment_id: WordSchema.shape.segment_id })
  .refine(validTiming, timingError)
export type EditorEmbeddedWord = z.infer<typeof EditorEmbeddedWordSchema>

export const EditorTranscriptSchema = TranscriptSchema.pick({
  status: true,
  title: true,
  project_id: true,
  created_at: true,
  engine: true,
  engine_model: true,
  duration_seconds: true,
  waveform_status: true,
})
export type EditorTranscript = z.infer<typeof EditorTranscriptSchema>
export const EditorSpeakerSchema = SpeakerSchema
