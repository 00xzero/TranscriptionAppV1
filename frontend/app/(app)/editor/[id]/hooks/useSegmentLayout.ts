import { useMemo } from 'react'
import type { Seg } from '../types'

/** Retains the rows from the last timing or speaker change. Their text may be stale. */
export function useSegmentLayout(segments: readonly Seg[]): readonly Seg[] {
  const retainLayout = useMemo(() => {
    let previous: readonly Seg[] = []
    return (rows: readonly Seg[]) => {
      if (rows.length === previous.length && rows.every((row, index) => {
        const was = previous[index]
        return row === was || (row.id === was.id && row.speaker_id === was.speaker_id &&
          row.start_ms === was.start_ms && row.end_ms === was.end_ms)
      })) return previous
      previous = rows
      return rows
    }
  }, [])
  return useMemo(() => retainLayout(segments), [retainLayout, segments])
}
