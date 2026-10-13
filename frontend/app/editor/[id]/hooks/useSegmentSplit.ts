import { useCallback, useEffect, useRef, useState } from 'react'
import { alignTokens } from '@/core/transcript/word-alignment'
import { findSplit } from '@/core/transcript/segment-split'
import {
  rejoinSegments,
  splitSegment,
  type RejoinSegmentsRequest,
  type SplitSegmentRequest,
} from '@/lib/supabase/queries'
import { toast } from '@/components/ui/toaster'
import { randomUuid } from '@/lib/ids'
import { CONFLICT_TOAST, isConflict, isGone, isUncertainOutcome } from '@/lib/people/errors'
import type { EditorWord, Seg, WordsBySegment } from '../types'
import { REPLAY_DELAYS_MS } from '../utils'
import {
  applyRejoinSegments,
  applyRejoinWords,
  applySplitSegments,
  applySplitWords,
  joinSegmentTexts,
} from './segmentSplit'
import { UNDO_WINDOW_MS, type Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'
import type { ReloadResult, SaveOutcome } from './useTranscriptMutations'

/** Why a segment is closed to edits: a split or undo waiting on the database. */
export type BusyKind = 'splitting' | 'undoing' | 'unconfirmed'

type Hold = { kind: BusyKind }
type Held = { set(kind: BusyKind): void; release(): void }

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
  reloadSegments: () => Promise<ReloadResult | null>
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
    const token: Hold = { kind }
    for (const id of ids) holdsRef.current.set(id, [...(holdsRef.current.get(id) ?? []), token])
    publish()
    return {
      set(next) { token.kind = next; publish() },
      release() {
        for (const id of ids) {
          const rest = (holdsRef.current.get(id) ?? []).filter((held) => held !== token)
          if (rest.length) holdsRef.current.set(id, rest)
          else holdsRef.current.delete(id)
        }
        publish()
      },
    }
  }, [publish])

  // A replay that cannot reach the database leaves the segments busy, since
  // editing a shape that may already have changed could save text into the
  // wrong one. Retry replays the same request.
  const leaveUnconfirmed = useCallback((held: Held, title: string, retry: () => void) => {
    held.set('unconfirmed')
    toast({ title, variant: 'error', durationMs: Infinity, action: { label: 'Retry', onClick: retry } })
  }, [])

  // Runs inside the write queue.
  const settleRejoin = useCallback(async (
    request: RejoinSegmentsRequest,
    captured: { first: readonly EditorWord[]; next: readonly EditorWord[] },
    caret: number,
    held: Held,
    retryUndo: () => void
  ): Promise<void> => {
    held.set('undoing')
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await rejoinSegments(request)
        segments.update((current) => applyRejoinSegments(current, row, request.nextSegmentId))
        words.update((current) => applyRejoinWords(current, row.id, request.nextSegmentId, captured))
        setEditingTexts((prev) => {
          const { [request.nextSegmentId]: removed, ...rest } = prev
          return removed !== undefined || row.id in prev ? { ...rest, [row.id]: row.text } : rest
        })
        held.release()
        if (editingIdRef.current === request.nextSegmentId) openEditorAt(row.id, caret)
        return
      } catch (error) {
        if (isUncertainOutcome(error)) {
          if (attempt < REPLAY_DELAYS_MS.length) {
            await sleep(REPLAY_DELAYS_MS[attempt])
            continue
          }
          leaveUnconfirmed(held, "Couldn't reach the server to finish the undo",
            () => void enqueue(() => settleRejoin(request, captured, caret, held, retryUndo)))
          return
        }
        if (isConflict(error) || isGone(error)) {
          if (!(await reloadSegments())) {
            leaveUnconfirmed(held, "Couldn't reach the server to finish the undo",
              () => void enqueue(() => settleRejoin(request, captured, caret, held, retryUndo)))
            return
          }
          held.release()
          toast({ title: "Can't undo — changed since", variant: 'error' })
          return
        }
        console.error('undo split failed', error)
        held.release()
        toast({ title: "Couldn't undo", variant: 'error', action: { label: 'Retry', onClick: retryUndo } })
        return
      }
    }
  }, [segments, words, enqueue, setEditingTexts, reloadSegments, openEditorAt, leaveUnconfirmed])

  /** Join a split's halves back together, as they are when the undo runs. */
  const undo = useCallback((firstId: string, nextId: string) => {
    const held = hold([firstId, nextId], 'undoing')
    const retry = () => undo(firstId, nextId)
    // Saved ahead of the undo in the queue, so the join reads saved text.
    const flushed = Promise.all([flushSave(firstId), flushSave(nextId)])
    void enqueue(async () => {
      const outcomes = await flushed
      if (outcomes.includes('stale')) { held.release(); return }
      if (outcomes.includes('failed')) {
        held.release()
        toast({ title: "Couldn't undo — your latest edit isn't saved yet", variant: 'error', action: { label: 'Retry', onClick: retry } })
        return
      }
      const first = segments.get().find((segment) => segment.id === firstId)
      const next = segments.get().find((segment) => segment.id === nextId)
      const firstWords = words.get().get(firstId) ?? []
      const nextWords = words.get().get(nextId) ?? []
      if (!first || !next || nextWords.length === 0) {
        held.release()
        toast({ title: "Can't undo — changed since", variant: 'error' })
        return
      }
      const text = joinSegmentTexts(first.text, next.text)
      await settleRejoin({
        segmentId: firstId,
        expectedRevision: first.revision,
        nextSegmentId: nextId,
        expectedNextRevision: next.revision,
        nextFirstWordId: nextWords[0].id,
        text,
      }, { first: [...firstWords], next: [...nextWords] }, first.text.trimEnd().length + 1, held, retry)
    })
  }, [hold, flushSave, enqueue, segments, words, settleRejoin])

  // Runs inside the write queue.
  const settleSplit = useCallback(async (
    request: SplitSegmentRequest,
    captured: readonly EditorWord[],
    splitWordIndex: number,
    held: Held
  ): Promise<void> => {
    held.set('splitting')
    const retry = () => void enqueue(() => settleSplit(request, captured, splitWordIndex, held))
    for (let attempt = 0; ; attempt++) {
      try {
        const rows = await splitSegment(request)
        segments.update((current) => applySplitSegments(current, rows))
        words.update((current) => applySplitWords(current, rows, captured, splitWordIndex))
        setEditingTexts((prev) => ({ ...prev, [rows[0].id]: rows[0].text, [rows[1].id]: rows[1].text }))
        held.release()
        openEditorAt(rows[1].id, 0)
        toast({ title: 'Segment split', durationMs: UNDO_WINDOW_MS,
          action: { label: 'Undo', onClick: () => undo(rows[0].id, rows[1].id) } })
        return
      } catch (error) {
        if (isUncertainOutcome(error)) {
          if (attempt < REPLAY_DELAYS_MS.length) {
            await sleep(REPLAY_DELAYS_MS[attempt])
            continue
          }
          leaveUnconfirmed(held, "Couldn't reach the server to finish the split", retry)
          return
        }
        if (isConflict(error) || isGone(error)) {
          // Changed elsewhere, or split here and then reshaped elsewhere: the
          // database's segments and words replace the captured ones.
          if (!(await reloadSegments())) {
            leaveUnconfirmed(held, "Couldn't reach the server to finish the split", retry)
            return
          }
          held.release()
          if (segments.get().some((segment) => segment.id === request.newSegmentId)) {
            openEditorAt(request.newSegmentId, 0)
            toast({ title: 'Segment split — changed in another tab since' })
          } else {
            toast({ title: CONFLICT_TOAST, variant: 'error' })
          }
          return
        }
        console.error('split failed', error)
        held.release()
        toast({ title: "Couldn't split this segment", variant: 'error' })
        return
      }
    }
  }, [segments, words, enqueue, setEditingTexts, reloadSegments, openEditorAt, leaveUnconfirmed, undo])

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
    const held = hold([segId], 'splitting')
    // Saved ahead of the split in the queue; the split task reads the outcome.
    const flushed = flushSave(segId)
    void enqueue(async () => {
      const outcome = await flushed
      if (outcome === 'stale') { held.release(); return }
      if (outcome === 'failed') {
        held.release()
        toast({ title: "Couldn't split — your latest edit isn't saved yet", variant: 'error' })
        return
      }
      await settleSplit(request, captured, plan.splitWordIndex, held)
    })
  }, [segments, words, hold, flushSave, enqueue, settleSplit])

  return { busy, anyBusy: busy.size > 0, split }
}
