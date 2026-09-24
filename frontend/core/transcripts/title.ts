import { TEXT_LIMITS } from '@/contracts/limits'

export const TRANSCRIPT_TITLE_TOO_LONG = `Titles must be ${TEXT_LIMITS.transcriptTitle} characters or fewer.`

export function transcriptTitleTooLong(title: string): boolean {
  return title.trim().length > TEXT_LIMITS.transcriptTitle
}

/**
 * Fits a filename-derived fallback title under the title cap.
 *
 * Only for titles nobody typed: a long filename would otherwise be rejected by
 * the API. Never apply it to an explicit title — those are held to the cap by
 * their inputs and must not be changed silently; an over-long one is rejected.
 */
export function fitTranscriptTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length <= TEXT_LIMITS.transcriptTitle) return trimmed
  let end = TEXT_LIMITS.transcriptTitle - 1
  // Step back rather than keep half of a surrogate pair (e.g. an emoji).
  const lastKept = trimmed.charCodeAt(end - 1)
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) end -= 1
  return `${trimmed.slice(0, end).trimEnd()}…`
}
