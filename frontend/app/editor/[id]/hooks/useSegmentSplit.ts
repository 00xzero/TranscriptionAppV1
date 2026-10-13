import { useCallback, useEffect, useRef, useState } from 'react'
import { alignTokens } from '@/core/transcript/word-alignment'
import { findSplit } from '@/core/transcript/segment-split'
import {
  rejoinSegments,
  splitSegment,
  type RejoinSegmentsRequest,
  type SplitSegmentRequest,
} from '@/lib/supabase/queries'
import { toast, type ToastOptions } from '@/components/ui/toaster'
import { UNDO_WINDOW_MS } from '@/lib/undo'
import { randomUuid } from '@/lib/ids'
import { CONFLICT_TOAST, isConflict, isGone, isUncertainOutcome } from '@/lib/people/errors'
import type { Seg, WordsBySegment } from '../types'
import { REPLAY_DELAYS_MS } from '../utils'
import {
  applyRejoinSegments,
  applyRejoinWords,
  applySplitWords,
  joinSegmentTexts,
  upsertSegments,
} from './segmentSplit'
import type { Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'
import type { SaveOutcome } from './useTranscriptMutations'

/** Why a segment is closed to edits: a split or undo waiting on the database. */
export type BusyKind = 'splitting' | 'undoing' | 'unconfirmed'

type Hold = { kind: BusyKind; undo: boolean; retry?: () => void }
type Held = {
  set(kind: BusyKind, retry?: () => void): void
  release(): void
  /** True while another split or undo also holds one of these segments. */
  shared(): boolean
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/**
 * Split a segment at the caret, and undo it from the toast. Neither changes
 * the screen until the database confirms it; meanwhile the segments involved
 * are busy, closed to typing, replace and further splits. Drafts are saved
 * first, so a structural write never runs on top of unsaved text. A lost
 * answer is settled by replaying the same request, never by guessing: the
 * database recognises a write it already made, and the segment stays busy
 * until it has said so either way.
 */
export function useSegmentSplit({
  segments,
  words,
  enqueue,
  editingId,
  setEditingTexts,
  flushSave,
  reloadSegments,
  openEditorAt,
}: {
  segments: LiveStore<Seg[]>
  words: LiveStore<WordsBySegment>
  enqueue: Enqueue
  editingId: string | null
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  flushSave: (segId: string) => Promise<SaveOutcome>
  reloadSegments: () => Promise<boolean>
  openEditorAt: (segId: string, offset: number) => void
}) {
  const editingIdRef = useRef(editingId)
  useEffect(() => { editingIdRef.current = editingId }, [editingId])

  // Each pending split or undo holds its segments; the newest hold names the
  // status a segment shows. Read synchronously, so a second Enter before the
  // next render is still turned away.
  const holdsRef = useRef(new Map<string, Hold[]>())
  const [busy, setBusy] = useState<ReadonlyMap<string, BusyKind>>(() => new Map())
  const publish = useCallback(() => {
    setBusy(new Map([...holdsRef.current].map(([id, holds]) => [id, holds[holds.length - 1].kind])))
  }, [])
  const hold = useCallback((ids: readonly string[], kind: BusyKind): Held => {
    const token: Hold = { kind, undo: kind === 'undoing' }
    for (const id of ids) holdsRef.current.set(id, [...(holdsRef.current.get(id) ?? []), token])
    publish()
    return {
      set(next, retry) { token.kind = next; token.retry = retry; publish() },
      release() {
        for (const id of ids) {
          const rest = (holdsRef.current.get(id) ?? []).filter((held) => held !== token)
          if (rest.length) holdsRef.current.set(id, rest)
          else holdsRef.current.delete(id)
        }
        publish()
      },
      shared: () => ids.some((id) => (holdsRef.current.get(id) ?? []).some((held) => held !== token)),
    }
  }, [publish])

  // A replay that cannot reach the database leaves the segments busy, since
  // editing a shape that may already have changed could save text into the
  // wrong one. Retry, on the card or in the toast, replays the same request.
  // The card keeps it after the toast is gone; whichever is used first wins,
  // and the other then does nothing.
  const leaveUnconfirmed = useCallback((held: Held, what: 'split' | 'undo', replay: () => void) => {
    let used = false
    const retry = () => {
      if (used) return
      used = true
      held.set(what === 'split' ? 'splitting' : 'undoing')
      replay()
    }
    held.set('unconfirmed', retry)
    toast({ title: `Couldn't reach the server to finish the ${what}`, variant: 'error', action: { label: 'Retry', onClick: retry } })
  }, [])

  /** Retry a split or undo the database has not confirmed, from its card. */
  const retryUnconfirmed = useCallback((segId: string) => {
    const holds = holdsRef.current.get(segId)
    holds?.[holds.length - 1].retry?.()
  }, [])

  /**
   * Runs inside the write queue: whether the drafts saved ahead of a split or
   * undo were written. If not, the hold is released. A stale draft has
   * reloaded the segments and said so already; a failed one is reported here.
   */
  const draftsSaved = useCallback(async (
    flushed: Promise<SaveOutcome | SaveOutcome[]>, held: Held, failed: ToastOptions
  ): Promise<boolean> => {
    const outcomes = [await flushed].flat()
    if (!outcomes.includes('stale') && !outcomes.includes('failed')) return true
    held.release()
    if (!outcomes.includes('stale')) toast(failed)
    return false
  }, [])

  /**
   * Runs inside the write queue: calls the database until it answers for
   * certain. A lost answer is replayed with the same request; one still
   * unreachable after that leaves the hold unconfirmed, and its Retry runs
   * `replay`. A refusal because the segments changed reloads them first. The
   * hold is released on every outcome but success, which the caller applies
   * before releasing it.
   */
  const settle = useCallback(async <T>(
    held: Held, what: 'split' | 'undo', call: () => Promise<T>, replay: () => void
  ): Promise<{ done: T } | 'changed' | 'refused' | 'unconfirmed'> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return { done: await call() }
      } catch (error) {
        if (isUncertainOutcome(error) && attempt < REPLAY_DELAYS_MS.length) {
          await sleep(REPLAY_DELAYS_MS[attempt])
          continue
        }
        // Changed elsewhere, or done here and then reshaped elsewhere: the
        // database's segments and words replace the ones captured.
        const changed = isConflict(error) || isGone(error)
        if (isUncertainOutcome(error) || (changed && !(await reloadSegments()))) {
          leaveUnconfirmed(held, what, replay)
          return 'unconfirmed'
        }
        held.release()
        if (changed) return 'changed'
        console.error(`${what} failed`, error)
        return 'refused'
      }
    }
  }, [reloadSegments, leaveUnconfirmed])

  /** Join a split's halves back together, as they are when the undo runs. */
  const undo = useCallback((firstId: string, nextId: string) => {
    // A second click on the same Undo (its toast fades out still clickable)
    // is the same request, not a conflict: the first one answers it.
    if (holdsRef.current.get(firstId)?.some((h) => h.undo)) return
    const held = hold([firstId, nextId], 'undoing')
    const retry = () => undo(firstId, nextId)
    // Saved ahead of the undo in the queue, so the join reads saved text.
    const flushed = Promise.all([flushSave(firstId), flushSave(nextId)])
    void enqueue(async () => {
      const failed: ToastOptions = { title: "Couldn't undo — your latest edit isn't saved yet", variant: 'error',
        action: { label: 'Retry', onClick: retry } }
      if (!(await draftsSaved(flushed, held, failed))) return
      // Queued ahead of this undo, a split of either half may have ended
      // unconfirmed: it may or may not have happened. Joining now could delete
      // the segment its Retry still has to settle.
      if (held.shared()) {
        held.release()
        toast({ title: "Can't undo yet", description: "A split of this segment isn't confirmed. Retry it on the segment first.",
          variant: 'error', action: { label: 'Undo', onClick: retry } })
        return
      }
      const first = segments.get().find((segment) => segment.id === firstId)
      const next = segments.get().find((segment) => segment.id === nextId)
      const captured = { first: [...words.get().get(firstId) ?? []], next: [...words.get().get(nextId) ?? []] }
      if (!first || !next || captured.next.length === 0) {
        held.release()
        toast({ title: "Can't undo — changed since", variant: 'error' })
        return
      }
      const { text, seam } = joinSegmentTexts(first.text, next.text)
      const request: RejoinSegmentsRequest = {
        segmentId: firstId,
        expectedRevision: first.revision,
        nextSegmentId: nextId,
        expectedNextRevision: next.revision,
        nextFirstWordId: captured.next[0].id,
        text,
      }
      // Retry, if the answer is lost, runs this again with the same request.
      const settleRejoin = async (): Promise<void> => {
        const outcome = await settle(held, 'undo', () => rejoinSegments(request), () => void enqueue(settleRejoin))
        if (outcome === 'changed') toast({ title: "Can't undo — changed since", variant: 'error' })
        if (outcome === 'refused') toast({ title: "Couldn't undo", variant: 'error', action: { label: 'Retry', onClick: retry } })
        if (typeof outcome !== 'object') return
        const row = outcome.done
        segments.update((current) => applyRejoinSegments(current, row, nextId))
        words.update((current) => applyRejoinWords(current, row.id, nextId, captured))
        setEditingTexts((prev) => {
          const { [nextId]: removed, ...rest } = prev
          return removed !== undefined || row.id in prev ? { ...rest, [row.id]: row.text } : rest
        })
        held.release()
        if (editingIdRef.current === nextId) openEditorAt(row.id, seam)
      }
      await settleRejoin()
    })
  }, [hold, flushSave, enqueue, draftsSaved, segments, words, settle, setEditingTexts, openEditorAt])

  /**
   * Split a segment at a caret in its text (the text as typed, which may not
   * be saved yet). Nothing happens where there is no split, or while the
   * segment is busy.
   */
  const split = useCallback((segId: string, text: string, caret: number) => {
    if (holdsRef.current.has(segId)) return
    const segment = segments.get().find((s) => s.id === segId)
    if (!segment) return
    const segWords = words.get().get(segId) ?? []
    const plan = findSplit(alignTokens(text, segWords, segment.start_ms, segment.end_ms), segWords, text, caret, segment.start_ms)
    if (!plan) return

    const request: SplitSegmentRequest = {
      segmentId: segId,
      expectedRevision: segment.revision,
      splitWordId: segWords[plan.splitWordIndex].id,
      firstText: plan.firstText,
      secondText: plan.secondText,
      newSegmentId: randomUuid(),
    }
    const captured = [...segWords]
    // The new half is held too: a reload can show it before this split is
    // confirmed, and text typed there would be overwritten when it is.
    const held = hold([segId, request.newSegmentId], 'splitting')
    // Editing moves to the new half only from the half it was split from: the
    // answer can come late, and by then the user may be typing elsewhere.
    const followSplit = () => {
      if (editingIdRef.current === segId) openEditorAt(request.newSegmentId, 0)
    }

    // Retry, if the answer is lost, runs this again with the same request.
    const settleSplit = async (): Promise<void> => {
      const outcome = await settle(held, 'split', () => splitSegment(request), () => void enqueue(settleSplit))
      if (outcome === 'refused') toast({ title: "Couldn't split this segment", variant: 'error' })
      if (outcome === 'changed') {
        if (segments.get().some((s) => s.id === request.newSegmentId)) {
          followSplit()
          toast({ title: 'Segment split — changed in another tab since' })
        } else {
          toast({ title: CONFLICT_TOAST, variant: 'error' })
        }
      }
      if (typeof outcome !== 'object') return
      const rows = outcome.done
      segments.update((current) => upsertSegments(current, rows))
      words.update((current) => applySplitWords(current, rows, captured, plan.splitWordIndex))
      setEditingTexts((prev) => ({ ...prev, [rows[0].id]: rows[0].text, [rows[1].id]: rows[1].text }))
      held.release()
      followSplit()
      toast({ title: 'Segment split', durationMs: UNDO_WINDOW_MS,
        action: { label: 'Undo', onClick: () => undo(rows[0].id, rows[1].id) } })
    }

    // Saved ahead of the split in the queue; the split task reads the outcome.
    const flushed = flushSave(segId)
    void enqueue(async () => {
      if (await draftsSaved(flushed, held, { title: "Couldn't split — your latest edit isn't saved yet", variant: 'error' })) {
        await settleSplit()
      }
    })
  }, [segments, words, hold, openEditorAt, settle, enqueue, setEditingTexts, undo, flushSave, draftsSaved])

  return { busy, anyBusy: busy.size > 0, split, retry: retryUnconfirmed }
}
