import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSegmentsWithWords, setSegmentTexts, type SegmentTextEdit } from '@/lib/supabase/queries'
import { toast } from '@/components/ui/toaster'
import { CONFLICT_TOAST, DROPPED_DRAFT_MESSAGE, STALE_TOAST, changedSince } from '@/lib/people/errors'
import { OutcomeUnknown, SendClosed, type Send } from '@/lib/editor/untilAnswered'
import type { Seg, SaveStatusBySegment, WordsBySegment } from '../types'
import { SAVE_DEBOUNCE_MS, groupSourceWords } from '../utils'
import type { Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'
import { changedElsewhere, type Direction } from './useEditorHistory'

export type TextEdit = { segId: string; before: string; after: string }
export type CaretHint = { start: number; end: number; seq: number }

/** Unsaved text for a segment, and the revision it was edited against. */
type Draft = { text: string; revision: number }

export function useTranscriptMutations({
  transcriptId,
  segments,
  words,
  enqueue,
  send,
  onExternalChange,
}: {
  transcriptId: string
  segments: LiveStore<Seg[]>
  words: LiveStore<WordsBySegment>
  enqueue: Enqueue
  send: Send
  /** A reload found changes made elsewhere; `quiet` when the editor has already said so. */
  onExternalChange?: (quiet: boolean) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTexts, setEditingTexts] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<SaveStatusBySegment>({})
  const saveTimers = useRef<Record<string, number>>({})
  const saveStatusResetTimers = useRef<Record<string, number>>({})
  // Text not saved yet, per segment. A save clears only the draft it wrote, so
  // an edit made while it was in flight keeps its own.
  const drafts = useRef(new Map<string, Draft>())
  // Set while a save of every waiting draft is queued and has not started.
  const saveAllQueued = useRef(false)
  // Each segment's text as the database holds it, as far as this editor knows:
  // what a save expects to replace. Set when a segment's first draft starts,
  // and from every row a write or reload returns. While a write's outcome is
  // unknown, the text it writes may be there instead.
  const baseline = useRef(new Map<string, { text: string; unconfirmed?: string }>())
  const adopt = useCallback((rows: readonly Seg[]) => {
    rows.forEach((row) => baseline.current.set(row.id, { text: row.text }))
  }, [])

  // Where the caret goes when the next editor opens (after a split or undo).
  // Read, not consumed, so a re-run layout effect finds it too; it lapses once
  // editing moves elsewhere.
  const caretHintRef = useRef<({ segId: string } & CaretHint) | null>(null)
  const caretSequence = useRef(0)
  useEffect(() => {
    if (caretHintRef.current && caretHintRef.current.segId !== editingId) caretHintRef.current = null
  }, [editingId])

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((timerId) => window.clearTimeout(timerId))
      Object.values(saveStatusResetTimers.current).forEach((timerId) => window.clearTimeout(timerId))
      saveTimers.current = {}
      saveStatusResetTimers.current = {}
    }
  }, [])

  const clearSaveTimer = useCallback((segId: string) => {
    const t = saveTimers.current[segId]
    if (t) { window.clearTimeout(t); delete saveTimers.current[segId] }
  }, [])

  const showSaveStatus = useCallback((segId: string, status: SaveStatusBySegment[string]) => {
    const resetT = saveStatusResetTimers.current[segId]
    if (resetT) { window.clearTimeout(resetT); delete saveStatusResetTimers.current[segId] }
    setSaveStatus((prev) => ({ ...prev, [segId]: status }))
    if (status !== 'saved') return
    saveStatusResetTimers.current[segId] = window.setTimeout(() => {
      delete saveStatusResetTimers.current[segId]
      setSaveStatus((p) => ({ ...p, [segId]: 'idle' }))
    }, 1200)
  }, [])

  /**
   * Replace the segments and words with the database's, read together so each
   * segment's words belong to the revision it is shown at. A draft the
   * database already holds was saved (its answer was lost). A draft still
   * written against what the database holds survives; any other was overtaken
   * by a change made elsewhere and is dropped, and the user is told, with its
   * text to copy. Resolves false if the database refused the read, leaving
   * everything as it was; an unanswered read is sent again until answered.
   *
   * It writes nothing, so it runs inside a queued task, never queueing one.
   */
  const reloadSegments = useCallback(async (): Promise<boolean> => {
    let rows: Seg[]
    let wordRows: readonly unknown[]
    try {
      const fetched = await send(() => fetchSegmentsWithWords(transcriptId))
      rows = fetched.map(({ words: _words, ...row }) => row)
      wordRows = fetched.flatMap((row) => row.words)
    } catch (error) {
      if (!(error instanceof SendClosed)) console.error(`[editor] failed to reload segments for transcript ${transcriptId}:`, error)
      return false
    }

    const fetched = new Map(rows.map((row) => [row.id, row]))
    for (const [segId, draft] of drafts.current) {
      const row = fetched.get(segId)
      if (row?.text !== draft.text || row.revision !== draft.revision) continue
      drafts.current.delete(segId)
      clearSaveTimer(segId)
      showSaveStatus(segId, 'saved')
      adopt([row])
    }
    const dropped: string[] = []
    for (const [segId, draft] of drafts.current) {
      const row = fetched.get(segId)
      const known = baseline.current.get(segId)
      if (row && row.revision === draft.revision && (row.text === known?.text || row.text === known?.unconfirmed)) continue
      dropped.push(draft.text)
      drafts.current.delete(segId)
      clearSaveTimer(segId)
      showSaveStatus(segId, 'idle')
    }
    // Anything the database holds that this editor did not show, beyond its
    // own unsaved text, was changed elsewhere.
    const shown = new Map(segments.get().map((row) => [row.id, row]))
    const external = dropped.length > 0 || [...shown.keys()].some((id) => !fetched.has(id)) || rows.some((row) => {
      const was = shown.get(row.id)
      return !was || was.revision !== row.revision || was.speaker_id !== row.speaker_id ||
        (!drafts.current.has(row.id) && was.text !== row.text)
    })

    adopt(rows)
    const next = rows.map((row) => {
      const draft = drafts.current.get(row.id)
      return draft ? { ...row, text: draft.text } : row
    })
    const textById = new Map(next.map((row) => [row.id, row.text]))
    // Worked out once: a live store runs its updater again inside React.
    const grouped = groupSourceWords(wordRows)
    segments.update(() => next)
    words.update(() => grouped)
    setEditingTexts((prev) => Object.fromEntries(
      Object.keys(prev).flatMap((id) => textById.has(id) ? [[id, textById.get(id)!]] : [])
    ))
    setEditingId((prev) => (prev && textById.has(prev) ? prev : null))
    if (external) onExternalChange?.(dropped.length > 0)
    if (dropped.length > 0) {
      const text = dropped.join('\n\n')
      toast({
        title: CONFLICT_TOAST, description: DROPPED_DRAFT_MESSAGE, variant: 'error', durationMs: 15000,
        action: { label: 'Copy text', onClick: () => { void navigator.clipboard?.writeText(text).catch(() => undefined) } },
      })
    }
    return true
  }, [transcriptId, segments, words, send, clearSaveTimer, showSaveStatus, adopt, onExternalChange])

  /**
   * Write segment texts, sending until answered. Until then, the text each
   * edit writes may be what the database holds: a resend refused after an
   * attempt went unanswered leaves it so for the reload that follows, which
   * then keeps text typed on top of it.
   */
  const writeTexts = useCallback(async (edits: readonly SegmentTextEdit[]) => {
    edits.forEach((e) => baseline.current.set(e.segment_id, { text: e.expected_text, unconfirmed: e.text }))
    try {
      adopt(await send(() => setSegmentTexts(edits)))
    } catch (error) {
      // Refused at the first attempt: nothing was written.
      if (!(error instanceof OutcomeUnknown)) edits.forEach((e) => baseline.current.set(e.segment_id, { text: e.expected_text }))
      throw error
    }
  }, [send, adopt])

  /**
   * Write the waiting drafts of these segments, all or nothing. Each expects
   * the text the database holds and the revision it was typed against. Runs
   * inside the write queue. A refusal is thrown: one because something changed
   * elsewhere (or whose outcome is unknown) is the caller's to settle by
   * reading the database again; any other first marks the drafts not saved.
   */
  const writeDrafts = useCallback(async (segIds: readonly string[]) => {
    const waiting = segIds.flatMap((segId) => {
      const draft = drafts.current.get(segId)
      const known = baseline.current.get(segId)
      return draft && known ? [{ segId, draft, expected: known.text }] : []
    })
    if (!waiting.length) return
    const edits: SegmentTextEdit[] = waiting.map(({ segId, draft, expected }) => ({
      segment_id: segId, expected_revision: draft.revision, expected_text: expected, text: draft.text,
    }))
    try {
      await writeTexts(edits)
    } catch (error) {
      if (!(error instanceof SendClosed) && !changedElsewhere(error)) {
        console.error('save failed', error)
        for (const { segId, draft } of waiting) if (drafts.current.get(segId) === draft) showSaveStatus(segId, 'error')
      }
      throw error
    }
    for (const { segId, draft } of waiting) if (drafts.current.get(segId) === draft) {
      drafts.current.delete(segId)
      showSaveStatus(segId, 'saved')
    }
  }, [writeTexts, showSaveStatus])

  /**
   * Runs a text step of the history inside the write queue: the drafts of its
   * segments are written first, then each segment, still showing what the
   * step left, takes the text undo or redo gives it. On screen at once; the
   * write expects what the database holds. A refused write is put back on
   * screen only where nothing has been typed over it since.
   */
  const applyTexts = useCallback(async (edits: readonly TextEdit[], dir: Direction, applied: () => void) => {
    await writeDrafts(edits.map((e) => e.segId))
    const current = new Map(segments.get().map((s) => [s.id, s]))
    const request: SegmentTextEdit[] = edits.map((e) => {
      const row = current.get(e.segId)
      const expected = dir === 'undo' ? e.after : e.before
      if (!row || row.text !== expected) throw changedSince('A segment changed since')
      return { segment_id: e.segId, expected_revision: row.revision, expected_text: expected, text: dir === 'undo' ? e.before : e.after }
    })
    const show = (pairs: readonly (readonly [string, string])[]) => {
      const map = new Map(pairs)
      segments.update((rows) => rows.map((row) => map.has(row.id) ? { ...row, text: map.get(row.id)! } : row))
      setEditingTexts((prev) => Object.fromEntries(Object.entries(prev).map(([id, text]) => [id, map.get(id) ?? text])))
    }
    show(request.map((e) => [e.segment_id, e.text] as const))
    applied()
    try {
      await writeTexts(request)
    } catch (error) {
      if (!changedElsewhere(error)) {
        const now = new Map(segments.get().map((row) => [row.id, row.text]))
        show(request.filter((e) => now.get(e.segment_id) === e.text).map((e) => [e.segment_id, e.expected_text] as const))
      }
      throw error
    }
  }, [writeDrafts, segments, writeTexts])

  const scheduleSave = useCallback((segId: string, newText: string) => {
    const segment = segments.get().find((s) => s.id === segId)
    if (!segment) return
    // The revision is fixed now, at the edit: if the segment is reshaped before
    // the save runs, the save is refused rather than written into the new shape.
    if (!baseline.current.has(segId)) baseline.current.set(segId, { text: segment.text })
    drafts.current.set(segId, { text: newText, revision: segment.revision })

    // update UI immediately
    segments.update((prev) => prev.map((s) => s.id === segId ? { ...s, text: newText } : s))
    showSaveStatus(segId, 'saving')

    // debounce before saving
    clearSaveTimer(segId)
    saveTimers.current[segId] = window.setTimeout(() => {
      delete saveTimers.current[segId]
      if (saveAllQueued.current) return
      saveAllQueued.current = true
      void enqueue(async () => {
        saveAllQueued.current = false
        // Every draft waiting now is saved with this one, so the drafts a
        // Replace All made together are written together, not one by one.
        let batch = [...drafts.current.keys()]
        batch.forEach(clearSaveTimer)
        while (batch.length) {
          const sent = batch.map((id) => drafts.current.get(id))
          try {
            await writeDrafts(batch)
            return
          } catch (error) {
            if (!changedElsewhere(error)) return
          }
          // One conflict refuses the whole batch. The database's segments
          // settle it: the reload drops the drafts it overtook and keeps the
          // rest, which are written again, except any typed over since: typing
          // queues its own save.
          if (!(await reloadSegments())) toast({ title: STALE_TOAST, variant: 'error' })
          const kept = batch.filter((id, i) => drafts.current.get(id) === sent[i])
          // None settled, dropped or typed over: the reload or the write was
          // refused for another reason. Stop, and say so.
          if (kept.length === batch.length) { kept.forEach((id) => showSaveStatus(id, 'error')); return }
          batch = kept
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }, [segments, showSaveStatus, clearSaveTimer, enqueue, writeDrafts, reloadSegments])

  /** Open the editor on a segment with the caret at an offset, or a selection. */
  const openEditorAt = useCallback((segId: string, selection: number | { start: number; end: number }) => {
    const range = typeof selection === 'number' ? { start: selection, end: selection } : selection
    caretHintRef.current = { segId, ...range, seq: ++caretSequence.current }
    setEditingId(segId)
  }, [])

  const caretHint = useCallback((segId: string): CaretHint | undefined =>
    caretHintRef.current?.segId === segId ? caretHintRef.current : undefined, [])

  return {
    editingId, setEditingId,
    editingTexts, setEditingTexts,
    saveStatus,
    scheduleSave,
    writeDrafts,
    applyTexts,
    reloadSegments,
    openEditorAt,
    caretHint,
    adopt,
  }
}
