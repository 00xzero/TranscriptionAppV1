import { z } from 'zod'

// How a transcript is made, chosen in the capture dialog and fixed once the
// transcript exists. What each engine can do is in
// core/transcription/engines/capabilities.ts. Source of truth: the columns of the same names on
// `transcripts` (infra/supabase/migrations/20261018000000_transcription_options.sql),
// whose CHECK repeats this language list.

// The engines a transcript can be made with, named by brand in the dialog.
export const TRANSCRIPTION_ENGINES = ['deepgram', 'soniox'] as const

export const TranscriptionEngineSchema = z.enum(TRANSCRIPTION_ENGINES)

export const TRANSCRIPTION_ENGINE_LABELS: Record<TranscriptionEngine, string> = {
  deepgram: 'Deepgram Nova-3',
  soniox: 'Soniox v5',
}

// The brand alone, where the model would read oddly ("Not available with Soniox").
export const TRANSCRIPTION_ENGINE_BRANDS: Record<TranscriptionEngine, string> = {
  deepgram: 'Deepgram',
  soniox: 'Soniox',
}

// Nova-3 languages offered. `multi` follows audio that switches between ten of
// them (en, es, fr, de, hi, ru, pt, ja, it, nl).
export const TRANSCRIPTION_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'hi', 'ru', 'multi'] as const

export const TranscriptionLanguageSchema = z.enum(TRANSCRIPTION_LANGUAGES)

export const TRANSCRIPTION_LANGUAGE_LABELS: Record<TranscriptionLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  ja: 'Japanese',
  hi: 'Hindi',
  ru: 'Russian',
  multi: 'Mixed languages',
}

export const TranscriptionOptionsSchema = z.object({
  engine: TranscriptionEngineSchema,
  language: TranscriptionLanguageSchema,
  detect_speakers: z.boolean(),
  // Only some engines and languages keep "um" and "uh"; see fillerWordsApply.
  keep_filler_words: z.boolean(),
  mask_profanity: z.boolean(),
})

// Options saved before the engine could be chosen: queued events, recordings
// waiting in the browser, the last choice a browser remembers, and a tab opened
// before then. Read them through resolveTranscriptionOptions.
export const SavedTranscriptionOptionsSchema = TranscriptionOptionsSchema.extend({
  engine: TranscriptionEngineSchema.optional(),
})

export type TranscriptionEngine = z.infer<typeof TranscriptionEngineSchema>
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>
export type TranscriptionOptions = z.infer<typeof TranscriptionOptionsSchema>
export type SavedTranscriptionOptions = z.infer<typeof SavedTranscriptionOptionsSchema>

export const DEFAULT_TRANSCRIPTION_OPTIONS: TranscriptionOptions = Object.freeze({
  engine: 'deepgram',
  language: 'en',
  detect_speakers: true,
  keep_filler_words: true,
  mask_profanity: false,
})

/**
 * Full options from saved ones. Events queued before the options existed have
 * none and get what every transcript got then; anything saved before the
 * engine could be chosen was made with Deepgram. (Inngest validates event data
 * but hands the handler the unparsed value, so a schema default can't do this.)
 */
export function resolveTranscriptionOptions(options: SavedTranscriptionOptions | undefined): TranscriptionOptions {
  if (!options) return DEFAULT_TRANSCRIPTION_OPTIONS
  return { ...options, engine: options.engine ?? 'deepgram' }
}
