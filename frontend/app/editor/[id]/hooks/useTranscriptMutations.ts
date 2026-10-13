import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSegmentsWithWords, updateSegment } from '@/lib/supabase/queries'
import { toast } from '@/components/ui/toaster'
import { CONFLICT_TOAST, DROPPED_DRAFT_MESSAGE, STALE_TOAST, isStaleSegmentSave } from '@/lib/people/errors'
import type { Seg, SaveStatusBySegment, WordsBySegment } from '../types'
import { SAVE_DEBOUNCE_MS, groupSourceWords } from '../utils'
import type { Enqueue } from './useEditorWriteQueue'
import type { LiveStore } from './useLiveStore'

/**
 * What became of a draft a structural write saved first: written, there was
 * none, the write failed, or the segment had changed shape since the text was
 * edited (the editor has reloaded and said so).
 */
export type SaveOutcome = 'saved' | 'nothing' | 'failed' | 'stale'

/** Unsaved text for a segment, and the revision it was edited against. */
type Draft = { text: string; revision: number }

export function useTranscriptMutations({
  transcriptId,
  segments,
  words,
  enqueue,
}: {
  transcriptId: string
  segments: LiveStore<Seg[]>
  words: LiveStore<WordsBySegment>
  enqueue: Enqueue
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

  // Where the caret goes when the next editor opens (after a split or undo).
  // Read, not consumed, so a re-run layout effect finds it too; it lapses once
  // editing moves elsewhere.
  const caretHintRef = useRef<{ segId: string; offset: number } | null>(null)
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
   * segment's words belong to the revision it is shown at. A draft survives where
   * its segment still has the revision it was edited against; one whose
   * segment was reshaped or removed is dropped, and the user is told. Resolves
   * false if the database could not be read, leaving everything as it was.
   *
   * It writes nothing, so it runs inside a queued task, never queueing one.
   */
  const reloadSegments = useCallback(async (): Promise<boolean> => {
    let rows: Seg[]
    let wordRows: readonly unknown[]
    try {
      const fetched = await fetchSegmentsWithWords(transcriptId)
      rows = fetched.map(({ words: _words, ...row }) => row)
      wordRows = fetched.flatMap((row) => row.words)
    } catch (error) {
      console.error(`[editor] failed to reload segments for transcript ${transcriptId}:`, error)
      return false
    }

    const fetched = new Map(rows.map((row) => [row.id, row]))
    let droppedDrafts = false
    for (const [segId, draft] of drafts.current) {
      if (fetched.get(segId)?.revision === draft.revision) continue
      drafts.current.delete(segId)
      clearSaveTimer(segId)
      showSaveStatus(segId, 'idle')
      droppedDrafts = true
    }

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
    if (droppedDrafts) toast({ title: CONFLICT_TOAST, description: DROPPED_DRAFT_MESSAGE, variant: 'error' })
    return true
  }, [transcriptId, segments, words, clearSaveTimer, showSaveStatus])

  // Runs inside the write queue. The drafts are of different segments, so
  // they are written at once.
  const writeDrafts = useCallback(async (segIds: readonly string[]): Promise<SaveOutcome[]> => {
    const written = await Promise.all(segIds.map(async (segId) => {
      const draft = drafts.current.get(segId)
      if (!draft) return { segId, draft, outcome: 'nothing' as const }
      try {
        await updateSegment(segId, { text: draft.text }, draft.revision)
      } catch (error) {
        if (isStaleSegmentSave(error)) return { segId, draft, outcome: 'stale' as const }
        console.error('save failed', error)
        if (drafts.current.get(segId) === draft) showSaveStatus(segId, 'error')
        return { segId, draft, outcome: 'failed' as const }
      }
      if (drafts.current.get(segId) === draft) {
        drafts.current.delete(segId)
        showSaveStatus(segId, 'saved')
      }
      return { segId, draft, outcome: 'saved' as const }
    }))
    // A segment was split or rejoined elsewhere since its text was typed: one
    // reload, however many were refused, drops those drafts and says so. A
    // reload already run since has dropped them.
    const stale = written.some(({ segId, draft, outcome }) => outcome === 'stale' && drafts.current.get(segId) === draft)
    if (stale && !(await reloadSegments())) toast({ title: STALE_TOAST, variant: 'error' })
    return written.map(({ outcome }) => outcome)
  }, [reloadSegments, showSaveStatus])

  const scheduleSave = useCallback((segId: string, newText: string) => {
    const segment = segments.get().find((s) => s.id === segId)
    if (!segment) return
    // The revision is fixed now, at the edit: if the segment is reshaped before
    // the save runs, the save is refused rather than written into the new shape.
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
        const segIds = [...drafts.current.keys()]
        segIds.forEach(clearSaveTimer)
        await writeDrafts(segIds)
      })
    }, SAVE_DEBOUNCE_MS)
  }, [segments, showSaveStatus, clearSaveTimer, enqueue, writeDrafts])

  /**
   * Save a segment's draft now rather than after the debounce, and report
   * what happened. A structural write calls this first, so it never runs on
   * top of unsaved text. Call it from outside the write queue and await the
   * result inside the queued task: a queued task awaiting it would deadlock.
   */
  const flushSave = useCallback((segId: string): Promise<SaveOutcome> => {
    if (!drafts.current.has(segId)) return Promise.resolve('nothing')
    clearSaveTimer(segId)
    return enqueue(async () => (await writeDrafts([segId]))[0])
  }, [clearSaveTimer, enqueue, writeDrafts])

  /** Open the editor on a segment with the caret at `offset`. */
  const openEditorAt = useCallback((segId: string, offset: number) => {
    caretHintRef.current = { segId, offset }
    setEditingId(segId)
  }, [])

  const caretHint = useCallback((segId: string): number | undefined =>
    caretHintRef.current?.segId === segId ? caretHintRef.current.offset : undefined, [])

  return {
    editingId, setEditingId,
    editingTexts, setEditingTexts,
    saveStatus,
    scheduleSave,
    flushSave,
    reloadSegments,
    openEditorAt,
    caretHint,
  }
}
