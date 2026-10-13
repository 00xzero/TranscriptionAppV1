import { EditorSourceWordSchema, type EditorSourceWord } from '@/contracts/editor'
import type { EditorWord } from './types'

export const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
// Waits before replaying a split or undo whose answer was lost.
export const REPLAY_DELAYS_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? [1, 1, 1] : [1000, 2000, 4000]
export const SYNC_OFFSET_MS = 150
export const SEEK_LOCK_MS = 3000
export const PROGRAMMATIC_SCROLL_RESET_MS = 250
export const ACTIVE_CARD_VISIBILITY_MARGIN_PX = 24
export const WAVEFORM_COLLAPSE_THRESHOLD_RATIO = 0.6
export const WAVEFORM_EXPAND_THRESHOLD_RATIO = 0.35
export const DEFAULT_EXPANDED_WAVEFORM_HEIGHT_PX = 256
export const ASCII_WORD_CHAR_REGEX = /[A-Za-z0-9_]/
// Scripts with little/no case mapping support; used for whole-word boundary checks.
export const NON_CASED_WORD_CHAR_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/
export const COMBINING_MARK_START = 0x0300
export const COMBINING_MARK_END = 0x036f
export const SCROLL_INTENT_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])

export const isUnicodeWordChar = (char: string) => {
  if (!char) return false
  if (ASCII_WORD_CHAR_REGEX.test(char)) return true
  if (NON_CASED_WORD_CHAR_REGEX.test(char)) return true

  const code = char.charCodeAt(0)
  if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) return true

  // Unicode letters generally have different upper/lower-case transforms.
  return char.toLowerCase() !== char.toUpperCase()
}

/**
 * Validate loaded word rows one by one and group them per segment in spoken
 * order. Rows with a bad shape or impossible timing are dropped, so nothing
 * malformed reaches alignment or the playback binary searches.
 */
export function groupSourceWords(rows: readonly unknown[]): Map<string, EditorWord[]> {
  const rowsBySegment = new Map<string, EditorSourceWord[]>()
  let dropped = 0
  for (const row of rows) {
    const parsed = EditorSourceWordSchema.safeParse(row)
    if (!parsed.success) {
      dropped++
      continue
    }
    const list = rowsBySegment.get(parsed.data.segment_id)
    if (list) list.push(parsed.data)
    else rowsBySegment.set(parsed.data.segment_id, [parsed.data])
  }
  if (dropped > 0) {
    console.warn(`[editor] dropped ${dropped} word row(s) with an invalid shape or timing`)
  }

  const wordsBySegment = new Map<string, EditorWord[]>()
  for (const [segmentId, list] of rowsBySegment) {
    // (order_index, id): the order the database splits and joins words in.
    list.sort((a, b) => a.order_index - b.order_index || compareIds(a.id, b.id))
    wordsBySegment.set(segmentId, list.map((word) => ({
      id: word.id,
      text: word.punctuated_text ?? word.text,
      startMs: word.start_ms,
      endMs: word.end_ms,
    })))
  }
  return wordsBySegment
}

/** Ids in the database's byte order, which breaks ties in display order. */
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

type Revisioned = { id: string; revision: number }

/**
 * Whether every `expected` segment is among `current` at the same revision.
 * A split or rejoin always bumps the revision of a segment that exists both
 * before and after it, so this is how the editor tells that something read or
 * chosen earlier still describes the segments as they are.
 */
export function revisionsMatch(current: readonly Revisioned[], expected: readonly Revisioned[]): boolean {
  const revisions = new Map(current.map((segment) => [segment.id, segment.revision]))
  return expected.every((segment) => revisions.get(segment.id) === segment.revision)
}

/** Index of the last item that starts at or before `ms`, or -1 if none has. */
function lastStartedIndex<T>(items: readonly T[], ms: number, startOf: (item: T) => number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (startOf(items[mid]) <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * Finds the current segment at a playback position, for segments ordered by
 * start_ms, treating each as the half-open range [start_ms, end_ms):
 * - where segments overlap, the earliest one containing the position wins;
 * - where one ends exactly as the next starts, the next one contains it;
 * - in the silence between segments, the one heard last (latest end) stays current;
 * - before the first segment there is none.
 * Built once per segment list; each lookup is two binary searches.
 */
export function createSegmentLocator(
  segments: readonly { id: string; start_ms: number; end_ms: number }[]
): (ms: number) => string | undefined {
  // The latest end among each segment and those before it. It only rises at a
  // segment that sets a new latest end, so the first index where it passes a
  // position is a segment containing that position, if any segment does.
  const latestEnd: number[] = []
  const latestEndOwner: number[] = []
  let latest = -Infinity
  let owner = -1
  segments.forEach((s, i) => {
    if (s.end_ms > latest) {
      latest = s.end_ms
      owner = i
    }
    latestEnd.push(latest)
    latestEndOwner.push(owner)
  })

  return (ms) => {
    const lastStarted = lastStartedIndex(segments, ms, (s) => s.start_ms)
    if (lastStarted < 0) return undefined
    let lo = 0
    let hi = lastStarted
    let earliestContaining = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (latestEnd[mid] > ms) {
        earliestContaining = mid
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }
    return segments[earliestContaining >= 0 ? earliestContaining : latestEndOwner[lastStarted]].id
  }
}

/**
 * The token being spoken at `ms`: the last one that has started, so a word
 * stays current through the pause after it. Among tokens sharing a start time
 * the last is current. -1 before the first token.
 */
export function findCurrentTokenIndex(tokens: readonly { startMs: number }[], ms: number): number {
  return lastStartedIndex(tokens, ms, (t) => t.startMs)
}

// Format date as "Oct 24, 2023"
export const formatTranscriptDate = (dateStr: string | null): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
}

export function shouldCollapseWaveform(
  scrollTop: number,
  expandedWaveformHeight: number,
  thresholdRatio = WAVEFORM_COLLAPSE_THRESHOLD_RATIO
): boolean {
  const measuredHeight = Number.isFinite(expandedWaveformHeight) && expandedWaveformHeight > 0
    ? expandedWaveformHeight
    : DEFAULT_EXPANDED_WAVEFORM_HEIGHT_PX
  return scrollTop >= measuredHeight * thresholdRatio
}

export function getNextWaveformCollapsed(
  currentCollapsed: boolean,
  scrollTop: number,
  expandedWaveformHeight: number,
): boolean {
  const thresholdRatio = currentCollapsed
    ? WAVEFORM_EXPAND_THRESHOLD_RATIO
    : WAVEFORM_COLLAPSE_THRESHOLD_RATIO
  return shouldCollapseWaveform(scrollTop, expandedWaveformHeight, thresholdRatio)
}
