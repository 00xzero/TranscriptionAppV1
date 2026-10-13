import { useCallback, useRef } from 'react'

export type Enqueue = <T>(task: () => Promise<T>) => Promise<T>

/** How long a done toast offers Undo. */
export const UNDO_WINDOW_MS = 8000

/**
 * The editor's one write queue. Text saves, speaker actions and segment
 * splits run through it one at a time, in the order they were queued: a draft
 * saved before a split lands before it, and a save typed into the new half
 * lands after the split that created it. A failed task never blocks the next.
 *
 * A queued task must not await another task it queues itself: that task waits
 * behind the one awaiting it. Queue it first, from outside the queue, and
 * await its promise inside.
 */
export function useEditorWriteQueue(): Enqueue {
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  return useCallback(<T,>(task: () => Promise<T>) => {
    const next = queueRef.current.then(task, task)
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])
}
