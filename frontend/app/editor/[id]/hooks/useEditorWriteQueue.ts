import { useState } from 'react'

/**
 * What a queued task does: `write` an action (undo, split, a speaker change,
 * the title), `save` the drafts of typed text, or only `read`, which leaving
 * the editor need not wait for.
 */
export type TaskKind = 'write' | 'save' | 'read'

export type Enqueue = <T>(task: () => Promise<T>, kind?: TaskKind) => Promise<T>

export type WriteQueue = Enqueue & {
  /** Whether a write or save is queued or running. */
  writesPending(): boolean
  /** Whether an action other than a save of drafts is queued or running. */
  actionsPending(): boolean
  /** Resolves once no write or save is queued or running. */
  idle(): Promise<void>
}

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
export function useEditorWriteQueue(): WriteQueue {
  const [queue] = useState(createWriteQueue)
  return queue
}

function createWriteQueue(): WriteQueue {
  const queue = {
    tail: Promise.resolve() as Promise<unknown>,
    waiting: { write: 0, save: 0, read: 0 } as Record<TaskKind, number>,
    idlers: new Set<() => void>(),
  }
  const writes = () => queue.waiting.write + queue.waiting.save
  const enqueue = <T,>(task: () => Promise<T>, kind: TaskKind = 'write') => {
    const next = queue.tail.then(task, task)
    queue.tail = next.catch(() => undefined)
    queue.waiting[kind]++
    void queue.tail.then(() => {
      queue.waiting[kind]--
      if (writes() > 0) return
      for (const resolve of [...queue.idlers]) resolve()
      queue.idlers.clear()
    })
    return next
  }
  return Object.assign(enqueue, {
    writesPending: () => writes() > 0,
    actionsPending: () => queue.waiting.write > 0,
    idle: () => writes() === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => { queue.idlers.add(resolve) }),
  })
}
