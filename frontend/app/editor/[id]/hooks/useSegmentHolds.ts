import { useCallback, useMemo, useRef, useState } from 'react'

/** Why a segment is closed to edits: a split or undo of one waiting on the database, or another pending write. */
export type BusyKind = 'splitting' | 'undoing' | 'pending'

/**
 * What a hold closes. `text`: typing, splitting, replacing and the speaker
 * picker. `speaker`: only the speaker picker, so a speaker change waiting on
 * the database never locks a segment's text.
 */
export type HoldScope = 'text' | 'speaker'

export type Held = { release(): void }

type Hold = { ids: readonly string[]; kind: BusyKind; scope: HoldScope }

const neverReconnecting = () => false

/**
 * Segments (and the `title`, `person:<id>` and `speaker:<id>` resources) that
 * a queued write is about to change. Read synchronously, so a second action
 * before the next render is still turned away.
 */
export function useSegmentHolds(isReconnecting: () => boolean = neverReconnecting) {
  const holds = useRef(new Map<object, Hold>())
  const [version, setVersion] = useState(0)
  const publish = useCallback(() => setVersion((v) => v + 1), [])

  const hold = useCallback((ids: readonly string[], kind: BusyKind = 'pending', scope: HoldScope = 'text'): Held => {
    const token = {}
    holds.current.set(token, { ids, kind, scope })
    publish()
    return { release() { if (holds.current.delete(token)) publish() } }
  }, [publish])

  /** Whether any waiting write holds an id. */
  const has = useCallback((id: string) => [...holds.current.values()].some((h) => h.ids.includes(id)), [])
  /** Whether an action on these ids must wait: one is held, or the editor is reconnecting. */
  const blocked = useCallback((ids: readonly string[]) => isReconnecting() || ids.some(has), [isReconnecting, has])

  // The newest text hold names the status a segment shows; any hold closes its picker.
  const { busy, locked } = useMemo(() => {
    void version
    const busy = new Map<string, BusyKind>()
    const locked = new Set<string>()
    for (const { ids, kind, scope } of holds.current.values()) for (const id of ids) {
      locked.add(id)
      if (scope === 'text') busy.set(id, kind)
    }
    return { busy: busy as ReadonlyMap<string, BusyKind>, locked: locked as ReadonlySet<string> }
  }, [version])

  return useMemo(() => ({ busy, locked, hold, has, blocked, any: busy.size > 0 }), [busy, locked, hold, has, blocked])
}
export type SegmentHolds = ReturnType<typeof useSegmentHolds>
