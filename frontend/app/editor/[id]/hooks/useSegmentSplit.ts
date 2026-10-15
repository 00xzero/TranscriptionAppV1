import { useCallback, useEffect, useRef } from 'react'
import { alignTokens } from '@/core/transcript/word-alignment'
import { findSplit } from '@/core/transcript/segment-split'
import { randomUuid } from '@/lib/ids'
import { rejoinSegments, splitSegment, type RejoinSegmentsRequest, type SplitSegmentRequest } from '@/lib/supabase/queries'
import type { Send } from '@/lib/editor/untilAnswered'
import { changedSince } from '@/lib/people/errors'
import type { Seg, WordsBySegment } from '../types'
import { applyRejoinSegments, applyRejoinWords, applySplitWords, upsertSegments } from './segmentSplit'
import type { LiveStore } from './useLiveStore'
import type { EditorHistory, HistoryStep } from './useEditorHistory'
import type { useTranscriptMutations } from './useTranscriptMutations'
import type { SegmentHolds } from './useSegmentHolds'

/**
 * Split a segment at the caret, as a step of the editor's history. Neither the
 * split nor its undo (a rejoin) changes the screen until the database answers;
 * meanwhile the segments involved are held, closed to typing, replace and
 * further splits. Drafts are written first, so a structural write never runs on
 * top of unsaved text. The new half's id is chosen here, so a resend after a
 * lost answer, and a redo after an undo, both find or make that same segment.
 */
export function useSegmentSplit({ segments, words, history, editing, send, holds }: {
  segments: LiveStore<Seg[]>
  words: LiveStore<WordsBySegment>
  history: EditorHistory
  editing: ReturnType<typeof useTranscriptMutations>
  send: Send
  holds: SegmentHolds
}) {
  // Only what the steps use: a step lives in the history long after this render.
  const { editingId, writeDrafts, adopt, setEditingTexts, openEditorAt } = editing
  const { original: recordOriginal } = history
  const { blocked } = holds
  const editingIdRef = useRef(editingId)
  useEffect(() => { editingIdRef.current = editingId }, [editingId])

  /**
   * Split a segment at a caret in its text (the text as typed, which may not
   * be saved yet). Nothing happens where there is no split, while the segment
   * is held, or while the editor is reconnecting.
   */
  const split = useCallback((segId: string, wholeText: string, caret: number) => {
    if (blocked([segId])) return
    const original = segments.get().find((s) => s.id === segId)
    if (!original) return
    const captured = [...words.get().get(segId) ?? []]
    const plan = findSplit(alignTokens(wholeText, captured, original.start_ms, original.end_ms), captured, wholeText, caret, original.start_ms)
    if (!plan) return
    const newId = randomUuid()
    const speakerId = original.speaker_id

    // The split itself, first or as a redo. Runs inside the write queue.
    const forward = async (applied?: () => void) => {
      await writeDrafts([segId])
      const segment = segments.get().find((s) => s.id === segId)
      if (!segment || segment.text !== wholeText || segment.speaker_id !== speakerId) throw changedSince('The segment changed since')
      const request: SplitSegmentRequest = {
        segmentId: segId, expectedRevision: segment.revision, splitWordId: captured[plan.splitWordIndex].id,
        firstText: plan.firstText, secondText: plan.secondText, newSegmentId: newId,
        expectedText: wholeText, expectedSpeakerId: speakerId,
      }
      const rows = await send(() => splitSegment(request))
      segments.update((current) => upsertSegments(current, rows))
      words.update((current) => applySplitWords(current, rows, captured, plan.splitWordIndex))
      adopt(rows)
      setEditingTexts((prev) => ({ ...prev, [segId]: rows[0].text, [newId]: rows[1].text }))
      if (applied) applied()
      // Editing moves to the new half only from the half it was split from:
      // the answer can come late, and by then the user may be typing elsewhere.
      else if (editingIdRef.current === segId) openEditorAt(newId, 0)
    }

    const step: HistoryStep = {
      label: 'split', busy: { undo: 'undoing', redo: 'splitting' }, touches: [segId, newId],
      target: (dir) => dir === 'undo'
        ? { ids: [segId], selection: { start: caret, end: caret } }
        : { ids: [newId], selection: { start: 0, end: 0 } },
      async run(dir, applied) {
        if (dir === 'redo') { await forward(applied); return }
        await writeDrafts([segId, newId])
        const first = segments.get().find((s) => s.id === segId)
        const next = segments.get().find((s) => s.id === newId)
        const firstWords = [...words.get().get(segId) ?? []]
        const nextWords = [...words.get().get(newId) ?? []]
        if (!first || !next || !nextWords.length || first.text !== plan.firstText || next.text !== plan.secondText ||
            first.speaker_id !== speakerId || next.speaker_id !== speakerId) {
          throw changedSince('The halves changed since')
        }
        // Back to exactly the text that was split, not a join of the halves.
        const request: RejoinSegmentsRequest = {
          segmentId: segId, expectedRevision: first.revision, nextSegmentId: newId,
          expectedNextRevision: next.revision, nextFirstWordId: nextWords[0].id, text: wholeText,
          expectedText: first.text, expectedNextText: next.text,
          expectedSpeakerId: speakerId, expectedNextSpeakerId: speakerId,
        }
        const row = await send(() => rejoinSegments(request))
        segments.update((current) => applyRejoinSegments(current, row, newId))
        words.update((current) => applyRejoinWords(current, segId, newId, { first: firstWords, next: nextWords }))
        adopt([row])
        setEditingTexts((prev) => {
          const { [newId]: _removed, ...rest } = prev
          return { ...rest, [segId]: row.text }
        })
        applied()
      },
    }
    recordOriginal(step, () => forward())
  }, [blocked, segments, words, writeDrafts, adopt, setEditingTexts, openEditorAt, send, recordOriginal])

  return { split }
}
