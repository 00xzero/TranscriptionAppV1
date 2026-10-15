import { useCallback, useRef } from 'react'
import { TYPING_STEP_MAX, canExtend, classifyInput, type OpenTyping, type TextInput } from '@/core/editor/typing-steps'
import { typedQuote } from '@/core/editor/step-names'
import type { EditorHistory, HistoryStep } from './useEditorHistory'
import type { TextEdit, useTranscriptMutations } from './useTranscriptMutations'
export function useTextHistory({ record, historyVersion }: Pick<EditorHistory, 'record' | 'historyVersion'>,
  { applyTexts }: Pick<ReturnType<typeof useTranscriptMutations>, 'applyTexts'>) {
  const open = useRef<(OpenTyping & { edit: TextEdit; after: { start: number; end: number } }) | null>(null)
  // The step of a text just dragged out of a segment, which the drop in that
  // same segment completes. The drag's end forgets it, so a drop that lands
  // elsewhere leaves nothing for a later, unrelated drop to join.
  const dragged = useRef<{ segmentId: string; version: number; edit: TextEdit; after: { start: number; end: number } } | null>(null)
  // Ends the open typing step, Word-style; with a segment, only if the step is that segment's.
  const seal = useCallback((segmentId?: string) => {
    if (open.current && (!segmentId || open.current.segmentId === segmentId)) open.current.sealed = true
  }, [])
  const recordEdits = useCallback((label: string, edits: TextEdit[], before?: { start: number; end: number }, after?: { start: number; end: number }) => {
    const changed = edits.filter(e => e.before !== e.after)
    if (!changed.length) return false
    const ids = changed.map(e => e.segId)
    const selection = { before, after }
    const step: HistoryStep = {
      label, releaseOnApply: true, touches: ids,
      // A typing step's edit grows while it is open, so what it typed is read when asked.
      quote: label === 'typing' ? () => typedQuote(changed[0].before, changed[0].after) : undefined,
      run: (dir, applied) => applyTexts(changed, dir, applied),
      target: dir => ({ ids, selection: changed.length === 1 ? selection[dir === 'undo' ? 'before' : 'after'] : undefined }),
    }
    record(step)
    return true
  }, [record, applyTexts])
  const onTextInput = useCallback((segmentId: string, input: TextInput) => {
    if (input.before.text === input.after.text) return
    // A move within a segment, reported in two halves (as Chrome does), is one step.
    const move = dragged.current
    dragged.current = null
    if (move && input.inputType === 'insertFromDrop' && move.segmentId === segmentId && move.version === historyVersion()) {
      move.edit.after = input.after.text
      move.after.start = input.after.start; move.after.end = input.after.end
      return
    }
    const kind = classifyInput(input.inputType, input.before.start !== input.before.end)
    const inserted = Math.max(0, input.after.text.length - input.before.text.length)
    if (open.current && canExtend(open.current, segmentId, kind, historyVersion()) &&
        (input.composition || open.current.characters + inserted <= TYPING_STEP_MAX)) {
      open.current.edit.after = input.after.text
      open.current.after.start = input.after.start; open.current.after.end = input.after.end
      open.current.characters += inserted
      if (open.current.characters >= TYPING_STEP_MAX) open.current.sealed = true
      return
    }
    seal()
    const edit = { segId: segmentId, before: input.before.text, after: input.after.text }
    const after = { start: input.after.start, end: input.after.end }
    const recorded = recordEdits(kind === 'drag' ? 'drag and drop' : kind, [edit], { start: input.before.start, end: input.before.end }, after)
    if (recorded && input.inputType === 'deleteByDrag') dragged.current = { segmentId, version: historyVersion(), edit, after }
    if (recorded && kind === 'typing') open.current = { segmentId, version: historyVersion(), characters: inserted,
      sealed: inserted >= TYPING_STEP_MAX, edit, after }
  }, [historyVersion, recordEdits, seal])
  const recordReplace = useCallback((edits: TextEdit[], selection?: { start: number; end: number }, all = false) => {
    seal(); recordEdits(all ? 'replace all' : 'replace', edits, selection,
      selection && edits[0] ? { start: selection.start, end: selection.start + Math.max(0, edits[0].after.length - edits[0].before.length + selection.end - selection.start) } : undefined)
  }, [seal, recordEdits])
  const endDrag = useCallback(() => { dragged.current = null }, [])
  return { onTextInput, seal, recordReplace, endDrag }
}
