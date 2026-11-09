import { EditorEmbeddedWordSchema, EditorSourceWordSchema, type EditorEmbeddedWord } from '@/contracts/editor'
import type { EditorWord } from './types'

export const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
export const SYNC_OFFSET_MS = 150
export const SEEK_LOCK_MS = 3000
export const PROGRAMMATIC_SCROLL_RESET_MS = 250
export const ACTIVE_CARD_VISIBILITY_MARGIN_PX = 24
export const WAVEFORM_COLLAPSE_THRESHOLD_RATIO = 0.6
export const WAVEFORM_EXPAND_THRESHOLD_RATIO = 0.35
export const DEFAULT_EXPANDED_WAVEFORM_HEIGHT_PX = 256
export const SCROLL_INTENT_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])

// Letters, digits, combining marks and underscore count as part of a word.
const WORD_CHAR = /^[\p{L}\p{N}\p{M}_]/u

/** Whether the code point starting at `char[0]` belongs to a word. */
export const isUnicodeWordChar = (char: string) => WORD_CHAR.test(char)

/** The whole code point that ends just before `index` (both halves of a surrogate pair). */
export function codePointBefore(text: string, index: number): string {
  if (index <= 0) return ''
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index)
  }
  return text[index - 1]
}

// Invisible format characters (joiners, soft hyphens, direction marks) sit
// inside words, so Unicode's word-boundary rules look past them. A zero-width
// space is the exception: it marks a break.
const FORMAT_CHAR = /^\p{Cf}/u
const ZERO_WIDTH_SPACE = '\u200b'
const isIgnoredFormatChar = (char: string) => char !== ZERO_WIDTH_SPACE && FORMAT_CHAR.test(char)

/** The nearest code point before `index` that isn't an invisible format character. */
export function wordCharBefore(text: string, index: number): string {
  let char = codePointBefore(text, index)
  while (char && isIgnoredFormatChar(char)) {
    index -= char.length
    char = codePointBefore(text, index)
  }
  return char
}

/** The nearest code point from `index` on that isn't an invisible format character. */
export function wordCharAfter(text: string, index: number): string {
  while (index < text.length) {
    const char = String.fromCodePoint(text.codePointAt(index)!)
    if (!isIgnoredFormatChar(char)) return char
    index += char.length
  }
  return ''
}

function normaliseWords(words: EditorEmbeddedWord[]): EditorWord[] {
  // (order_index, id) is the order the database splits and joins words in.
  words.sort((a, b) => a.order_index - b.order_index || compareIds(a.id, b.id))
  return words.map((word) => ({
    id: word.id,
    text: word.punctuated_text ?? word.text,
    startMs: word.start_ms,
    endMs: word.end_ms,
  }))
}

function warnDroppedWords(dropped: number) {
  if (dropped) console.warn(`[editor] dropped ${dropped} word row(s) with an invalid shape or timing`)
}

/** Validate flat word rows and group them per segment in spoken order. */
export function groupSourceWords(rows: readonly unknown[]): Map<string, EditorWord[]> {
  const rowsBySegment = new Map<string, EditorEmbeddedWord[]>()
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
  warnDroppedWords(dropped)
  return new Map([...rowsBySegment].map(([id, words]) => [id, normaliseWords(words)]))
}

/** Validate embedded words under their parent without copying or flattening the payload. */
export function groupEmbeddedWords(sets: readonly { id: string; words: readonly unknown[] }[]) {
  const wordsBySegment = new Map<string, EditorWord[]>()
  let dropped = 0
  for (const { id, words } of sets) {
    const valid: EditorEmbeddedWord[] = []
    for (const word of words) {
      const parsed = EditorEmbeddedWordSchema.safeParse(word)
      if (parsed.success) valid.push(parsed.data)
      else dropped++
    }
    if (valid.length) wordsBySegment.set(id, normaliseWords(valid))
  }
  warnDroppedWords(dropped)
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
