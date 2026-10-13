import type { EditorWord, Seg, WordsBySegment } from '../types'

/**
 * The editor's side of a split and its undo, applied only once the database
 * has confirmed them. Each takes the rows the database returned and the words
 * captured for the request and sets the result outright, so applying one
 * twice, or after a reload already showed it, changes nothing.
 */

/** Display order, as the database sorts segments: start time, then id. */
export function compareSegments(a: Pick<Seg, 'id' | 'start_ms'>, b: Pick<Seg, 'id' | 'start_ms'>): number {
  if (a.start_ms !== b.start_ms) return a.start_ms - b.start_ms
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Put each row in place by id; a row not shown yet goes where display order puts it. */
export function upsertSegments(segments: readonly Seg[], rows: readonly Seg[]): Seg[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const result = segments.map((segment) => byId.get(segment.id) ?? segment)
  const shown = new Set(segments.map((segment) => segment.id))
  for (const row of rows) {
    if (shown.has(row.id)) continue
    const at = result.findIndex((segment) => compareSegments(row, segment) < 0)
    result.splice(at < 0 ? result.length : at, 0, row)
  }
  return result
}

/** The segment and its new half in place, from split_segment's rows. */
export function applySplitSegments(segments: readonly Seg[], rows: readonly [Seg, Seg]): Seg[] {
  return upsertSegments(segments, rows)
}

/** The words captured for the split, divided between the two halves. */
export function applySplitWords(
  words: WordsBySegment,
  rows: readonly [Seg, Seg],
  captured: readonly EditorWord[],
  splitWordIndex: number
): WordsBySegment {
  const next = new Map(words)
  next.set(rows[0].id, captured.slice(0, splitWordIndex))
  next.set(rows[1].id, captured.slice(splitWordIndex))
  return next
}

/** The joined row in place and the next segment gone, from rejoin_segments' row. */
export function applyRejoinSegments(segments: readonly Seg[], row: Seg, nextId: string): Seg[] {
  return upsertSegments(segments.filter((segment) => segment.id !== nextId), [row])
}

/** Both segments' captured words under the joined one. */
export function applyRejoinWords(
  words: WordsBySegment,
  rowId: string,
  nextId: string,
  captured: { first: readonly EditorWord[]; next: readonly EditorWord[] }
): WordsBySegment {
  const next = new Map(words)
  next.set(rowId, [...captured.first, ...captured.next])
  next.delete(nextId)
  return next
}

/** The text two halves join under, with one space at the seam. */
export function joinSegmentTexts(first: string, second: string): string {
  return `${first.trimEnd()} ${second.trimStart()}`
}
