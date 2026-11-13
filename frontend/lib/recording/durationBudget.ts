export const DURATION_WARNING_MS = 5 * 60_000
export const DURATION_STOP_HEADROOM_MS = 60_000

export const DURATION_WARNING_MESSAGE =
  'Less than 5 minutes until recording stops and transcription starts.'

export const AUTO_STOP_MESSAGES = {
  duration: 'Recording stopped automatically near the transcription time limit.',
  size: 'Recording stopped automatically near the upload size limit.',
} as const

export type AutoStopReason = keyof typeof AUTO_STOP_MESSAGES
