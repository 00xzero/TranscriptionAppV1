import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEditorSegmentSnapshot, fetchSegmentWordSets, setSegmentTexts } from '@/lib/supabase/queries'
import type { SegmentTextEdit } from '@/contracts/db'
import { toast } from '@/components/ui/toaster'
import { changedSince } from '@/lib/people/errors'
import { OutcomeUnknown, SendClosed, type Send } from '@/lib/editor/untilAnswered'
import { toastOvertakenEdits, TRANSCRIPT_DELETED_MESSAGE } from '@/lib/editor/unsavedToasts'
import type { Seg, SaveStatusBySegment, WordsBySegment } from '../types'
import { SAVE_DEBOUNCE_MS, groupEmbeddedWords, revisionsMatch } from '../utils'
import type { Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'
import { changedElsewhere, type Direction } from './useEditorHistory'

export type TextEdit = { segId: string; before: string; after: string }

export type CaretHint = { start: number; end: number; seq: number }

/** Unsaved text for a segment, and the revision it was edited against. */
type Draft = { text: string; revision: number }
/** A segment's draft as a save took it; gone if there was none. */
type SentDraft = { segId: string; draft: Draft | undefined }

const BULK_SAVE = 'bulk'
const SAVED_STATUS_MS = 1200

function guardedEdit(segId: string, draft: Draft, expected: string): SegmentTextEdit {
  return { segment_id: segId, expected_revision: draft.revision, expected_text: expected, text: draft.text }
}

function toastRefreshFailure(retry: () => void, notice?: string) {
  toast({
    title: 'Couldn’t refresh the transcript',
    description: ['Your unsaved edits are still here.', notice].filter(Boolean).join(' '),
    variant: 'error',
    action: { label: 'Retry', onClick: retry },
  })
}

export function useTranscriptMutations({
  transcriptId,
  segments,
  words,
  enqueue,
  send,
  onExternalChange,
  onDeleted,
  onWordLoadFailure,
  onWordMismatch,
}: {
  transcriptId: string
  segments: LiveStore<Seg[]>
  words: LiveStore<WordsBySegment>
  enqueue: Enqueue
  send: Send
  /** A reload found changes made elsewhere; `quiet` when the editor has already said so. */
  onExternalChange?: (quiet: boolean) => void
  onDeleted?: () => void
  onWordLoadFailure?: () => void
  onWordMismatch?: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatusBySegment>({})
  const saveTimers = useRef<Record<string, number>>({})
  const statusDeadlines = useRef(new Map<string, number>())
  const statusTimer = useRef<number | undefined>(undefined)
  // Text not saved yet, per segment. A save clears only the draft it wrote, so
  // an edit made while it was in flight keeps its own.
  const drafts = useRef(new Map<string, Draft>())
  // Set while a save of every waiting draft is queued and has not started.
  const saveAllQueued = useRef(false)
  const refreshBeforeSave = useRef(false)
  const active = useRef(true)
  const deleted = useRef(false)
  const wordLoad = useRef(0)
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

  const clearSaveTimer = useCallback((segId: string) => {
    const t = saveTimers.current[segId]
    if (t) { window.clearTimeout(t); delete saveTimers.current[segId] }
  }, [])

  const scheduleStatusExpiry = useCallback(function scheduleExpiry() {
    window.clearTimeout(statusTimer.current)
    statusTimer.current = undefined
    let next = Infinity
    for (const deadline of statusDeadlines.current.values()) next = Math.min(next, deadline)
    if (next === Infinity) return
    statusTimer.current = window.setTimeout(() => {
      const now = Date.now()
      const due: string[] = []
      for (const [id, deadline] of statusDeadlines.current) {
        if (deadline > now) continue
        statusDeadlines.current.delete(id)
        due.push(id)
      }
      if (due.length) setSaveStatus((previous) => {
        const next = { ...previous }
        for (const id of due) if (next[id] === 'saved') delete next[id]
        return next
      })
      scheduleExpiry()
    }, Math.max(0, next - Date.now()))
  }, [])

  const showSaveStatuses = useCallback((ids: readonly string[], status: SaveStatusBySegment[string]) => {
    if (!ids.length) return
    const deadline = Date.now() + SAVED_STATUS_MS
    for (const id of ids) {
      if (status === 'saved') statusDeadlines.current.set(id, deadline)
      else statusDeadlines.current.delete(id)
    }
    setSaveStatus((previous) => {
      const next = { ...previous }
      for (const id of ids) {
        if (status === 'idle') delete next[id]
        else next[id] = status
      }
      return next
    })
    scheduleStatusExpiry()
  }, [scheduleStatusExpiry])

  const loadWords = useCallback(async (retryMismatch: boolean) => {
    const request = ++wordLoad.current
    const current = () => active.current && !deleted.current && request === wordLoad.current
    try {
      const sets = await fetchSegmentWordSets(transcriptId)
      if (!current()) return
      const shown = segments.get()
      if (shown.length !== sets.length || !revisionsMatch(shown, sets)) {
        if (retryMismatch && onWordMismatch) onWordMismatch()
        else onWordLoadFailure?.()
        return
      }
      const grouped = groupEmbeddedWords(sets)
      words.update(() => grouped)
    } catch {
      if (current()) onWordLoadFailure?.()
    }
  }, [transcriptId, segments, words, onWordLoadFailure, onWordMismatch])

  /** Reconcile a complete snapshot inside the queue. Timings load independently. */
  const reloadSegments = useCallback(async ({
    refreshWords = false,
    retryWordMismatch = true,
    onRecovered,
    historyNotice,
  }: {
    refreshWords?: boolean
    retryWordMismatch?: boolean
    onRecovered?: () => void
    historyNotice?: string
  } = {}): Promise<boolean> => {
    if (!active.current || deleted.current) throw new SendClosed()
    let rows: Seg[] | null
    try {
      rows = await send(() => fetchEditorSegmentSnapshot(transcriptId))
    } catch (error) {
      if (error instanceof SendClosed) throw error
      console.error(`[editor] failed to reload segments for transcript ${transcriptId}:`, error)
      return false
    }
    if (!active.current || deleted.current) throw new SendClosed()
    if (!rows) {
      deleted.current = true
      const overtaken = [...drafts.current.values()].map(({ text }) => ({ text }))
      drafts.current.clear()
      onExternalChange?.(true)
      if (overtaken.length) toastOvertakenEdits(overtaken, true, historyNotice)
      else toast({ title: TRANSCRIPT_DELETED_MESSAGE, variant: 'error' })
      onDeleted?.()
      throw new SendClosed()
    }

    const fetched = new Map(rows.map((row) => [row.id, row]))
    const shownRows = segments.get()
    const shown = new Map(shownRows.map((row) => [row.id, row]))
    const settled: string[] = []
    const overtaken: Parameters<typeof toastOvertakenEdits>[0][number][] = []
    const droppedIds: string[] = []
    for (const [segId, draft] of drafts.current) {
      const row = fetched.get(segId)
      const known = baseline.current.get(segId)
      if (row?.revision === draft.revision && row.text === draft.text) {
        settled.push(segId)
      } else if (row?.revision === draft.revision && (row.text === known?.text || row.text === known?.unconfirmed)) {
        continue
      } else {
        overtaken.push({
          text: draft.text,
          reason: !row ? 'deleted' : row.revision !== draft.revision ? 'reshaped' : undefined,
        })
        droppedIds.push(segId)
      }
      drafts.current.delete(segId)
      clearSaveTimer(segId)
    }
    showSaveStatuses(settled, 'saved')
    showSaveStatuses(droppedIds, 'idle')
    // Anything the database holds that this editor did not show, beyond its
    // own unsaved text, was changed elsewhere.
    const reshaped = rows.length !== shownRows.length || !revisionsMatch(shownRows, rows)
    const external = overtaken.length > 0 || reshaped || rows.some((row) => {
      const was = shown.get(row.id)
      const known = baseline.current.get(row.id)
      return !was || was.speaker_id !== row.speaker_id ||
        (!drafts.current.has(row.id) && was.text !== row.text && row.text !== known?.text && row.text !== known?.unconfirmed)
    })

    for (const id of shown.keys()) if (!fetched.has(id)) baseline.current.delete(id)
    adopt(rows)
    const next = rows.map((row) => {
      const draft = drafts.current.get(row.id)
      const text = draft?.text ?? row.text
      const was = shown.get(row.id)
      if (was?.text === text && was.revision === row.revision && was.speaker_id === row.speaker_id &&
          was.updated_at === row.updated_at && was.is_edited === row.is_edited &&
          was.start_ms === row.start_ms && was.end_ms === row.end_ms) return was
      return draft ? { ...row, text } : row
    })
    if (overtaken.length) {
      toastOvertakenEdits(overtaken, false, historyNotice)
      onRecovered?.()
    }
    if (reshaped) {
      const paired = new Map([...words.get()].filter(([id]) => {
        const row = fetched.get(id)
        return row && shown.get(id)?.revision === row.revision
      }))
      words.update(() => paired)
    }
    if (next.length !== shownRows.length || next.some((row, index) => row !== shownRows[index])) {
      segments.update(() => next)
    }
    const nextById = new Map(next.map((row) => [row.id, row]))
    setEditingId((prev) => {
      if (!prev) return prev
      const before = shown.get(prev)
      const after = nextById.get(prev)
      return after && before?.text === after.text && before.revision === after.revision ? prev : null
    })
    if (external) onExternalChange?.(overtaken.length > 0)
    if (reshaped || refreshWords) void loadWords(retryWordMismatch)
    return true
  }, [transcriptId, segments, words, send, clearSaveTimer, showSaveStatuses, adopt, onExternalChange, onDeleted, loadWords])

  /**
   * Write segment texts, sending until answered. Until then, the text each
   * edit writes may be what the database holds: a resend refused after an
   * attempt went unanswered leaves it so for the reload that follows, which
   * then keeps text typed on top of it.
   */
  const writeTexts = useCallback(async (edits: readonly SegmentTextEdit[]) => {
    edits.forEach((e) => baseline.current.set(e.segment_id, { text: e.expected_text, unconfirmed: e.text }))
    try {
      const written = await send(() => setSegmentTexts(edits))
      // The RPC commits the whole batch, even when PostgREST caps its returned rows.
      for (const edit of edits) baseline.current.set(edit.segment_id, { text: edit.text })
      adopt(written)
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
    const edits = waiting.map(({ segId, draft, expected }) => guardedEdit(segId, draft, expected))
    const currentDrafts = () => waiting.filter(({ segId, draft }) => drafts.current.get(segId) === draft).map(({ segId }) => segId)
    try {
      await writeTexts(edits)
    } catch (error) {
      if (!(error instanceof SendClosed) && !changedElsewhere(error)) {
        console.error('save failed', error)
        showSaveStatuses(currentDrafts(), 'error')
      }
      throw error
    }
    const saved = currentDrafts()
    for (const id of saved) drafts.current.delete(id)
    showSaveStatuses(saved, 'saved')
  }, [writeTexts, showSaveStatuses])

  const clearSaveTimers = useCallback(() => {
    Object.keys(saveTimers.current).forEach(clearSaveTimer)
  }, [clearSaveTimer])

  useEffect(() => {
    active.current = true
    const deadlines = statusDeadlines.current
    return () => {
      active.current = false
      wordLoad.current++
      clearSaveTimers()
      window.clearTimeout(statusTimer.current)
      statusTimer.current = undefined
      deadlines.clear()
    }
  }, [clearSaveTimers])

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

  /**
   * Saves every waiting draft, together, in the write queue, unless a save of
   * them is already queued and has not started.
   */
  const saveAll = useCallback(function saveAll(refreshFirst = false) {
    if (!active.current || deleted.current) return
    refreshBeforeSave.current ||= refreshFirst
    if (saveAllQueued.current) return
    saveAllQueued.current = true
    void enqueue(async () => {
      saveAllQueued.current = false
      if (!active.current || deleted.current) return
      const needsRefresh = refreshBeforeSave.current
      refreshBeforeSave.current = false
      // Every draft waiting now is saved with this one, so the drafts a
      // Replace All made together are written together, not one by one.
      clearSaveTimers()
      const repair = async () => {
        try {
          if (await reloadSegments()) return !deleted.current
        } catch (error) {
          if (error instanceof SendClosed) return false
          console.error(`[editor] failed to reload segments for transcript ${transcriptId}:`, error)
        }
        showSaveStatuses([...drafts.current.keys()], 'error')
        toastRefreshFailure(() => saveAll(true))
        return false
      }
      if (needsRefresh && !(await repair())) return
      let batch = [...drafts.current.keys()]
      while (batch.length) {
        const sent: SentDraft[] = batch.map((segId) => ({ segId, draft: drafts.current.get(segId) }))
        try {
          await writeDrafts(batch)
          return
        } catch (error) {
          // Shown as not saved, or the editor has closed.
          if (!changedElsewhere(error)) return
        }
        // One conflict refuses the whole batch. The database's segments
        // settle it: the reload retains overtaken drafts in the toast and keeps the
        // rest, which are written again, except any typed over since: typing
        // queues its own save.
        if (!(await repair())) return
        const kept = sent.filter(({ segId, draft }) => drafts.current.get(segId) === draft).map(({ segId }) => segId)
        // None settled, dropped or typed over: the reload or the write was
        // refused for another reason. Stop, and say so.
        if (kept.length === batch.length) { showSaveStatuses(kept, 'error'); return }
        batch = kept
      }
    }, 'save')
  }, [transcriptId, showSaveStatuses, clearSaveTimers, enqueue, writeDrafts, reloadSegments])

  const reportRefreshFailure = useCallback((notice?: string) => {
    if (!drafts.current.size) return false
    showSaveStatuses([...drafts.current.keys()], 'error')
    toastRefreshFailure(() => saveAll(true), notice)
    return true
  }, [showSaveStatuses, saveAll])

  const captureDraft = useCallback((segment: Seg, text: string) => {
    // Fix the revision at the edit so a later reshape refuses the save.
    if (!baseline.current.has(segment.id)) baseline.current.set(segment.id, { text: segment.text })
    drafts.current.set(segment.id, { text, revision: segment.revision })
  }, [])

  const stageSave = useCallback((updates: ReadonlyMap<string, string>, timerKey: string) => {
    if (!updates.size) return
    segments.update((rows) => rows.map((row) => {
      const text = updates.get(row.id)
      return text === undefined ? row : { ...row, text }
    }))
    showSaveStatuses([...updates.keys()], 'saving')
    clearSaveTimer(timerKey)
    saveTimers.current[timerKey] = window.setTimeout(() => {
      delete saveTimers.current[timerKey]
      saveAll()
    }, SAVE_DEBOUNCE_MS)
  }, [segments, showSaveStatuses, clearSaveTimer, saveAll])

  const getCurrentSegment = useCallback((segId: string) =>
    segments.get().find((row) => row.id === segId), [segments])

  const scheduleSave = useCallback((segId: string, text: string) => {
    if (deleted.current) return
    const segment = getCurrentSegment(segId)
    if (!segment) return
    captureDraft(segment, text)
    stageSave(new Map([[segId, text]]), segId)
  }, [getCurrentSegment, captureDraft, stageSave])

  const scheduleSaves = useCallback((edits: readonly TextEdit[]) => {
    if (deleted.current) return
    const rows = new Map(segments.get().map((row) => [row.id, row]))
    const updates = new Map<string, string>()
    for (const { segId, after } of edits) {
      const row = rows.get(segId)
      if (!row) continue
      captureDraft(row, after)
      clearSaveTimer(segId)
      updates.set(segId, after)
    }
    stageSave(updates, BULK_SAVE)
  }, [segments, captureDraft, clearSaveTimer, stageSave])

  /** Starts saving every waiting draft now, without waiting for its debounce. */
  const saveNow = useCallback(() => {
    if (!drafts.current.size) return
    clearSaveTimers()
    saveAll()
  }, [clearSaveTimers, saveAll])

  /** Whether any text is not saved yet. */
  const hasDrafts = useCallback(() => drafts.current.size > 0, [])

  /**
   * The writes that would save every waiting draft, built as a save would
   * build them, and the drafts' text. Read as the editor closes, to send them
   * once.
   */
  const draftEdits = useCallback(() => {
    const edits: SegmentTextEdit[] = []
    const texts: string[] = []
    for (const [segId, draft] of drafts.current) {
      texts.push(draft.text)
      const known = baseline.current.get(segId)
      if (known) edits.push(guardedEdit(segId, draft, known.text))
    }
    return { edits, texts }
  }, [])

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
    getCurrentSegment,
    saveStatus,
    scheduleSave, scheduleSaves,
    saveNow,
    hasDrafts,
    draftEdits,
    writeDrafts,
    applyTexts,
    reloadSegments,
    reportRefreshFailure,
    openEditorAt,
    caretHint,
    adopt,
  }
}
