import { formatDuration } from '@/components/Projects/format'
import { talkShare } from '@/core/people/directory'

/** A calendar date as the directory shows it: `12 Sep 2026`, in the reader's locale. */
export function formatPeopleDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * How long someone spoke in a transcript and their share of all its speaking:
 * `15 mins · 21% of the talking`. A share under half a percent reads `<1%`;
 * with no speaking time known for the transcript, only the time is shown.
 */
export function formatTalk(talkMs: number, transcriptTalkMs: number): string {
  const time = formatDuration(talkMs / 1000) ?? ''
  const share = talkShare(talkMs, transcriptTalkMs)
  if (share === null) return time
  return `${time} · ${share === 0 && talkMs > 0 ? '<1%' : `${share}%`} of the talking`
}

/** Characters as the database counts them, so an emoji is one. */
export function nameLength(name: string): number {
  return Array.from(name.trim()).length
}
