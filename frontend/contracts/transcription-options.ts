import { z } from 'zod'

// How a transcript is made, chosen in the capture dialog and fixed once the
// transcript exists. Source of truth: the columns of the same names on
// `transcripts` (infra/supabase/migrations/20261018000000_transcription_options.sql),
// whose CHECK repeats this language list.

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
  language: TranscriptionLanguageSchema,
  detect_speakers: z.boolean(),
  // Deepgram keeps "um" and "uh" only in English; other languages ignore it.
  keep_filler_words: z.boolean(),
  mask_profanity: z.boolean(),
})

export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>
export type TranscriptionOptions = z.infer<typeof TranscriptionOptionsSchema>

export const DEFAULT_TRANSCRIPTION_OPTIONS: TranscriptionOptions = Object.freeze({
  language: 'en',
  detect_speakers: true,
  keep_filler_words: true,
  mask_profanity: false,
})

/** Filler words are an English-only Deepgram feature. */
export function fillerWordsApply(language: TranscriptionLanguage): boolean {
  return language === 'en'
}

/**
 * The options an event carries. Events queued before the options existed have
 * none and get what every transcript got then. (Inngest validates event data
 * but hands the handler the unparsed value, so a schema default can't do this.)
 */
export function resolveTranscriptionOptions(options: TranscriptionOptions | undefined): TranscriptionOptions {
  return options ?? DEFAULT_TRANSCRIPTION_OPTIONS
}
