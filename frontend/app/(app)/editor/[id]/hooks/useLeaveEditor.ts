import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSegmentTexts } from '@/lib/supabase/queries'
import { useAfterUnmount } from '@/lib/hooks/useAfterUnmount'
import { setLeaveGuard, type LeaveTarget } from '@/lib/editor/leaveGuard'
import { LEFT_UNSAVED_MESSAGE, LEFT_UNSAVED_TOAST, copyText, toastUnsaved } from '@/lib/editor/unsavedToasts'
import type { SegmentTextEdit } from '@/contracts/db'
import type { WriteQueue } from './useEditorWriteQueue'

/** How long leaving waits for saves before it says so: a quick save shows nothing. */
export const LEAVE_SHOW_AFTER_MS = 300
/** How long leaving waits for saves before it offers to leave without them. */
export const LEAVE_STALL_MS = 8000

/**
 * Where leaving stands while the editor holds it: saving, slow (past
 * LEAVE_STALL_MS), failed (a save was refused), or offline (the editor is
 * reconnecting).
 */
export type LeavePhase = 'saving' | 'slow' | 'failed' | 'offline'

type Drafts = {
  /** Starts saving every waiting draft now. */
  saveNow(): void
  hasDrafts(): boolean
  draftEdits(): { edits: SegmentTextEdit[]; texts: string[] }
}

/**
 * The editor doesn't let the user go while it has work not saved. An in-app
 * navigation (a link, the sidebar, sign-out) is held: the drafts are saved
 * now, and the user goes once the write queue is empty and no draft is left.
 * Past LEAVE_SHOW_AFTER_MS it says it is saving; once a save fails, the
 * editor is reconnecting, or LEAVE_STALL_MS pass, it offers to stay or to
 * leave without saving. Reloading or closing the tab asks first.
 *
 * Browser Back and Forward can't be held: as the editor closes, it sends the
 * waiting drafts once, and says so, with their text to copy, if that fails or
 * if an action (undo, a split, a speaker change) was cut off.
 */
export function useLeaveEditor({ queue, editing, reconnecting }: {
  queue: WriteQueue
  editing: Drafts
  reconnecting: boolean
}) {
  const { saveNow, hasDrafts, draftEdits } = editing
  const router = useRouter()
  const [phase, setPhase] = useState<Exclude<LeavePhase, 'offline'> | null>(null)
  // Where the user asked to go; the newest ask wins.
  const target = useRef<LeaveTarget | null>(null)
  // Counts holds: one that has ended stops acting.
  const holds = useRef(0)
  const timers = useRef(new Set<number>())
  // Set when the user leaves without saving; asking to leave again clears it.
  const abandoned = useRef(false)
  // Set once the transcript is deleted: nothing is left to save.
  const deleted = useRef(false)
  // Set while leaving without saving runs its navigation, so one that asks
  // the editor again (sign-out) goes instead of being held a second time.
  const leavingAnyway = useRef(false)

  const pending = useCallback(() => !deleted.current && !leavingAnyway.current &&
    (queue.writesPending() || hasDrafts()), [queue, hasDrafts])

  // Ends the hold, if any: its timers, its target and its wait.
  const endHold = useCallback(() => {
    holds.current++
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current.clear()
    target.current = null
  }, [])

  const release = useCallback(() => {
    endHold()
    setPhase(null)
  }, [endHold])

  // Once the editor has gone, a hold ends, and the drafts it had are sent once.
  // What was waiting is read at the unmount, before the closing sender
  // settles the queue.
  const mounted = useAfterUnmount(useCallback(() => {
    const cutOff = queue.actionsPending()
    const drafts = draftEdits()
    return () => {
      endHold()
      if (!abandoned.current && !deleted.current) void sendOnce(cutOff, drafts)
    }
  }, [queue, draftEdits, endHold]))

  const go = useCallback(() => {
    const next = target.current
    release()
    if (typeof next === 'function') next()
    else if (next?.replace) router.replace(next.href, { scroll: next.scroll })
    else if (next) router.push(next.href, { scroll: next.scroll })
  }, [release, router])

  const leave = useCallback((next: LeaveTarget) => {
    const holding = target.current !== null
    target.current = next
    abandoned.current = false
    if (holding) return
    const hold = ++holds.current
    const current = () => mounted() && holds.current === hold
    saveNow()
    timers.current.add(window.setTimeout(() => { if (current()) setPhase((p) => p ?? 'saving') }, LEAVE_SHOW_AFTER_MS))
    timers.current.add(window.setTimeout(() => { if (current()) setPhase((p) => p === 'failed' ? p : 'slow') }, LEAVE_STALL_MS))
    void (async () => {
      let retried = false
      for (;;) {
        await queue.idle()
        if (!current()) return
        // Queued since the queue went idle: wait for that too.
        if (queue.writesPending()) continue
        if (!hasDrafts()) { go(); return }
        // Drafts left with nothing queued were typed since, or their save
        // failed: saved once more, then the user decides.
        if (retried) { setPhase('failed'); return }
        retried = true
        saveNow()
      }
    })()
  }, [queue, saveNow, hasDrafts, go, mounted])

  /** Leaves at once, sending nothing more. */
  const leaveAnyway = useCallback(() => {
    abandoned.current = true
    leavingAnyway.current = true
    try { go() } finally { leavingAnyway.current = false }
  }, [go])

  useEffect(
    () => setLeaveGuard({ pending, leave, unsavedTexts: () => draftEdits().texts }),
    [pending, leave, draftEdits]
  )

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending()) return
      saveNow()
      event.preventDefault()
      // Required by some browsers to show the warning.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pending, saveNow])

  return {
    /** Where leaving stands, or null while the user is not leaving (or it is quick). */
    phase: phase && phase !== 'failed' && reconnecting ? 'offline' as const : phase,
    /** Stays in the editor; its saves go on as before. */
    stay: release,
    leaveAnyway,
    /** Leaving from now on sends nothing: the transcript is gone. */
    abandon: useCallback(() => { deleted.current = true }, []),
    hasUnsaved: hasDrafts,
    copyUnsaved: useCallback(() => copyText(draftEdits().texts), [draftEdits]),
  }
}

/**
 * The editor has closed without being held: its waiting drafts are sent once,
 * not again if that fails. A draft whose save was already out is safe to send
 * again: the write recognises its own earlier success.
 */
async function sendOnce(cutOff: boolean, { edits, texts }: { edits: SegmentTextEdit[]; texts: string[] }) {
  const saved = edits.length ? await setSegmentTexts(edits).then(() => true, () => false) : true
  if (!saved) toastUnsaved(LEFT_UNSAVED_TOAST, LEFT_UNSAVED_MESSAGE, texts)
  else if (cutOff) toastUnsaved(LEFT_UNSAVED_TOAST, LEFT_UNSAVED_MESSAGE)
}
