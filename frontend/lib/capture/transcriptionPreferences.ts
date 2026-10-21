import {
  DEFAULT_TRANSCRIPTION_OPTIONS,
  SavedTranscriptionOptionsSchema,
  resolveTranscriptionOptions,
  type TranscriptionOptions,
} from '@/contracts/transcription-options'

// The options of the last transcript this browser began, offered again the next
// time the capture dialog opens. Per browser, like the preferred microphone.
export const TRANSCRIPTION_PREFERENCES_KEY = 'capture.transcriptionOptions'

export function readTranscriptionPreferences(): TranscriptionOptions {
  if (typeof window === 'undefined') return DEFAULT_TRANSCRIPTION_OPTIONS
  try {
    const raw = window.localStorage.getItem(TRANSCRIPTION_PREFERENCES_KEY)
    if (!raw) return DEFAULT_TRANSCRIPTION_OPTIONS
    // A choice saved before the engine could be chosen is kept, with Deepgram.
    const parsed = SavedTranscriptionOptionsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? resolveTranscriptionOptions(parsed.data) : DEFAULT_TRANSCRIPTION_OPTIONS
  } catch {
    return DEFAULT_TRANSCRIPTION_OPTIONS
  }
}

export function saveTranscriptionPreferences(options: TranscriptionOptions): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TRANSCRIPTION_PREFERENCES_KEY, JSON.stringify(options))
  } catch {
    // localStorage may be disabled — non-fatal
  }
}
