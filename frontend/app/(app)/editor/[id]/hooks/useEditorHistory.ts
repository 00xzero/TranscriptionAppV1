import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as stack from '@/core/editor/undo-history'
import { stepName } from '@/core/editor/step-names'
import { toast } from '@/components/ui/toaster'
import { CONFLICT_TOAST, STALE_TOAST, isConflict, isGone } from '@/lib/people/errors'
import { OutcomeUnknown, SendClosed } from '@/lib/editor/untilAnswered'
import type { Enqueue } from './useEditorWriteQueue'
import type { SegmentHolds, BusyKind, HoldScope } from './useSegmentHolds'

export type Direction = 'undo' | 'redo'
export type HistoryTarget = { ids?: readonly string[]; selection?: { start: number; end: number }; title?: boolean }
export type HistoryStep = {
  label: string
  /** What its action failing is called, when "Couldn't <label>" doesn't read right. */
  failure?: string
  /** What a typing step typed, when short enough to quote in the undo list. */
  quote?(): string | undefined
  /** False once the action that recorded it failed: a press queued for it does nothing. */
  alive?: boolean
  /** The status its held segments show while it runs; `pending` shows none. */
  busy?: Partial<Record<Direction, BusyKind>>
  /** What its hold closes; text unless it only changes speakers, or the title. */
  scope?: HoldScope
  /** A text step lets go of its segments once it is on screen; others when written. */
  releaseOnApply?: boolean
  /** What it changes, held while a press of it waits to run. */
  touches: readonly string[]
  /** Runs inside the write queue; calls `applied` as soon as the change is on screen. */
  run(dir: Direction, applied: () => void): Promise<void>
  target(dir: Direction): HistoryTarget
}

/** Thrown by an action that turned out to change nothing: its step is dropped quietly. */
export const NOTHING_CHANGED = { code: 'NOTHING_CHANGED' } as const

/**
 * A write refused because what it expected has changed, or one whose outcome
 * is unknown: either way the editor reads the database again and the history,
 * written against what was there, is cleared.
 */
export function changedElsewhere(error: unknown): boolean {
  return isConflict(error) || isGone(error) || error instanceof OutcomeUnknown
}

type Press = { step: HistoryStep; before: stack.History<HistoryStep>; records: number; cancelled?: boolean; release(): void }

/**
 * The editor's undo/redo history, Word-style: one linear list, presses run in
 * the write queue in the order made. The stack moves at the press, so holding
 * Ctrl+Z steps back at once; the segments a press will change are held until
 * it has run. Undo and redo pause while a write waits for the connection, and
 * while the editor reads the database again after a change made elsewhere.
 */
export function useEditorHistory({ enqueue, holds, reveal, refresh, isReconnecting, reconnecting }: {
  enqueue: Enqueue
  holds: SegmentHolds
  reveal(target: HistoryTarget): void
  /** Reads segments, speakers and the title again; false if the database refused. */
  refresh(): Promise<boolean>
  isReconnecting(): boolean
  reconnecting: boolean
}) {
  const { hold } = holds
  const history = useRef(stack.emptyHistory<HistoryStep>())
  const records = useRef(0)
  const pending = useRef(new Set<Press>())
  // Actions recorded but not yet run. They run on whatever the database holds
  // by then, so a clear for a change made elsewhere keeps their steps.
  const unsettled = useRef(new Set<HistoryStep>())
  const repairing = useRef(false)
  const mounted = useRef(true)
  const [rendered, setRendered] = useState({ history: stack.emptyHistory<HistoryStep>(), repairing: false })
  const notify = useCallback(() => {
    if (mounted.current) setRendered({ history: history.current, repairing: repairing.current })
  }, [])
  const cancelPending = useCallback(() => {
    for (const press of pending.current) { press.cancelled = true; press.release() }
    pending.current.clear()
  }, [])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelPending() } }, [cancelPending])

  /**
   * The history emptied of every step built on what was there, keeping, in
   * the order recorded, the steps of actions that have not run yet: they
   * will run, so each goes back to undo, even one a later edit took off redo.
   */
  const emptied = useCallback((h: stack.History<HistoryStep>): stack.History<HistoryStep> => ({
    done: [...unsettled.current].filter((s) => s.alive !== false),
    undone: [],
    version: h.version + 1,
  }), [])

  /** Empties the history; says so (once) when it removed anything. Returns whether it said so. */
  const clear = useCallback((title?: string): boolean => {
    const held = [...history.current.done, ...history.current.undone]
    history.current = emptied(history.current)
    const removed = held.some((s) => !history.current.done.includes(s))
    cancelPending(); notify()
    if (title && removed) toast({ title, description: 'Undo history cleared', variant: 'error' })
    return !!title && removed
  }, [emptied, cancelPending, notify])

  const record = useCallback((step: HistoryStep) => {
    step.alive = true
    records.current++
    history.current = stack.record(history.current, step); notify()
  }, [notify])

  const drop = useCallback((step: HistoryStep) => {
    step.alive = false
    history.current = stack.drop(history.current, step); notify()
  }, [notify])

  // Runs inside the write queue: read the database again, holding undo/redo
  // until it has answered. The reads themselves resend until answered.
  const repair = useCallback(async () => {
    repairing.current = true; notify()
    try {
      if (!(await refresh())) toast({ title: STALE_TOAST, variant: 'error' })
    } catch (error) {
      if (!(error instanceof SendClosed)) toast({ title: STALE_TOAST, variant: 'error' })
    } finally {
      repairing.current = false; notify()
    }
  }, [refresh, notify])

  /**
   * A write that failed. One closed with the editor needs nothing; one refused
   * because something changed elsewhere, or whose outcome is unknown, clears
   * the history and reads the database again; anything else is `otherwise`.
   */
  const failed = useCallback(async (error: unknown, title: string, otherwise: () => void) => {
    if (error instanceof SendClosed) return
    if (!changedElsewhere(error)) { otherwise(); return }
    if (!clear(title)) toast({ title, variant: 'error' })
    await repair()
  }, [clear, repair])

  /** One undo or redo; `reveals` false when a later press of the same click will show where it landed. */
  const press = useCallback((dir: Direction, reveals = true) => {
    if (repairing.current || isReconnecting()) return
    const before = history.current
    const [after, step] = dir === 'undo' ? stack.takeUndo(before) : stack.takeRedo(before)
    if (!step) return
    const held = hold(step.touches, step.busy?.[dir], step.scope)
    const request: Press = { step, before, records: records.current, release: held.release }
    history.current = after; pending.current.add(request); notify()
    void enqueue(async () => {
      pending.current.delete(request)
      if (!mounted.current || request.cancelled || step.alive === false) { held.release(); return }
      try {
        await step.run(dir, () => {
          if (step.releaseOnApply) held.release()
          if (mounted.current && reveals) reveal(step.target(dir))
        })
      } catch (error) {
        await failed(error, `Can't ${dir} — this changed elsewhere`, () => {
          // Nothing was written: back to before this press, unless something
          // was recorded since, which was built on the press having happened.
          const noNewRecords = records.current === request.records
          cancelPending()
          history.current = noNewRecords
            ? { done: before.done.filter((s) => s.alive !== false), undone: before.undone.filter((s) => s.alive !== false), version: history.current.version + 1 }
            : emptied(history.current)
          notify()
          toast({ title: `Couldn't ${dir} ${step.label}`, variant: 'error' })
        })
      } finally { held.release() }
    })
  }, [hold, notify, enqueue, reveal, failed, cancelPending, emptied, isReconnecting])
  const undo = useCallback(() => press('undo'), [press])
  const redo = useCallback(() => press('redo'), [press])
  /** Undoes the last `count` steps, as that many presses, showing only where the last one landed. */
  const undoMany = useCallback((count: number) => {
    for (let i = 1; i <= count; i++) press('undo', i === count)
  }, [press])
  /** The undo list's names, newest first. Read when the list opens: a typing step's name grows as it is typed. */
  const undoNames = useCallback(() => history.current.done.map((s) => stepName(s.label, s.quote?.())).reverse(), [])

  /**
   * Records an action's step at once, so presses keep their order, and runs
   * the action in the queue. A failed action drops its step; one refused
   * because something changed elsewhere also clears the history and reads the
   * database again. Until it has run, a clear keeps its step.
   */
  const original = useCallback((step: HistoryStep, perform: () => Promise<void>, onFailed?: (error: unknown) => void) => {
    record(step)
    unsettled.current.add(step)
    const held = hold(step.touches, step.busy?.redo, step.scope)
    void enqueue(async () => {
      if (!mounted.current) { unsettled.current.delete(step); held.release(); return }
      try { await perform() } catch (error) {
        drop(step)
        if (error !== NOTHING_CHANGED) await failed(error, CONFLICT_TOAST, () => {
          if (onFailed) onFailed(error)
          else toast({ title: step.failure ?? `Couldn't ${step.label}`, variant: 'error' })
        })
      } finally {
        unsettled.current.delete(step)
        held.release()
      }
    })
  }, [record, hold, enqueue, drop, failed])

  const historyVersion = useCallback(() => history.current.version, [])
  const paused = reconnecting || rendered.repairing
  return useMemo(() => ({ record, drop, original, press, undo, redo, undoMany, undoNames, clear, paused, historyVersion,
    canUndo: !paused && rendered.history.done.length > 0,
    canRedo: !paused && rendered.history.undone.length > 0,
    undoLabel: rendered.history.done.at(-1)?.label, redoLabel: rendered.history.undone.at(-1)?.label,
    version: rendered.history.version,
  }), [record, drop, original, press, undo, redo, undoMany, undoNames, clear, paused, historyVersion, rendered.history])
}
export type EditorHistory = ReturnType<typeof useEditorHistory>
