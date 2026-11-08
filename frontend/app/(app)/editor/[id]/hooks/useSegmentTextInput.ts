import React from 'react'
import type { SelectionText, TextInput } from '@/core/editor/typing-steps'
import { undoShortcut } from '@/lib/editor/undoShortcut'
import type { CaretHint } from './useTranscriptMutations'
import type { Seg } from '../types'

// Keeps the edit textarea exactly as tall as its content so entering edit mode
// never changes the segment's height.
function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  // scrollHeight covers content + padding, which is the whole box here: sizing is
  // border-box and the field's outline is an inset shadow, not a border. Give it a
  // real border and this under-measures by the border width, clipping the last line.
  el.style.height = `${el.scrollHeight}px`
}

// Keys that move the caret, which ends a typing step as in Word.
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

type CompositionBase = Pick<Seg, 'id' | 'revision' | 'text'>

function matchesBase(current: CompositionBase | undefined, base: CompositionBase) {
  return current?.id === base.id && current.revision === base.revision && current.text === base.text
}

function snapshot(node: HTMLTextAreaElement): SelectionText {
  return { text: node.value, start: node.selectionStart, end: node.selectionEnd }
}

export function useSegmentTextInput({
  segment: s, isEditing, cardRef, caretHint, setEditingId, getCurrentSegment,
  onTextInput, scheduleSave, sealTyping, endDrag, onHistory, onSplit,
}: {
  segment: Seg
  isEditing: boolean
  cardRef: React.RefObject<HTMLDivElement | null>
  caretHint: (segId: string) => CaretHint | undefined
  setEditingId: (id: string | null) => void
  getCurrentSegment: (segId: string) => Seg | undefined
  onTextInput: (segId: string, input: TextInput) => void
  scheduleSave: (segId: string, newText: string) => void
  sealTyping: (segId: string) => void
  endDrag?: () => void
  onHistory: (dir: 'undo' | 'redo') => void
  onSplit: (segId: string, text: string, caret: number) => void
}) {
  const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null)
  // The edit about to happen, from the field's native beforeinput: its kind,
  // and the text and selection it starts from.
  const beforeInput = React.useRef<{ inputType: string; before: SelectionText } | null>(null)
  const composition = React.useRef<{
    base: CompositionBase
    before: SelectionText
    invalidated: boolean
  } | null>(null)
  const [preview, setPreview] = React.useState<{ base: CompositionBase; text: string } | null>(null)
  const composing = isEditing && preview !== null && matchesBase(s, preview.base)
  if (preview && !composing) setPreview(null)
  const text = composing ? preview.text : s.text
  // Some browsers send the final input after compositionend.
  const completedComposition = React.useRef<{ text: string; data: string } | null>(null)
  const compositionEndTimer = React.useRef<number | undefined>(undefined)
  // The caret hint last applied, so each is applied once.
  const hintSequence = React.useRef(-1)
  // The selection as the last edit left it; a change from that is a caret move.
  const selection = React.useRef<{ start: number; end: number } | null>(null)
  React.useLayoutEffect(() => {
    const active = composition.current
    if (active && !matchesBase({ id: s.id, revision: s.revision, text: s.text }, active.base)) {
      active.invalidated = true
    }
  }, [s.id, s.revision, s.text])

  React.useLayoutEffect(() => {
    return () => {
      composition.current = null
      beforeInput.current = null
      completedComposition.current = null
      window.clearTimeout(compositionEndTimer.current)
    }
  }, [isEditing, s.id])

  // The browser's own undo (Edit menu, context menu) goes to the editor's history.
  React.useLayoutEffect(() => {
    const node = textAreaRef.current
    if (!isEditing || !node) return
    const listener = (e: InputEvent) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault()
        onHistory(e.inputType === 'historyUndo' ? 'undo' : 'redo')
        return
      }
      // A move within the field is one edit. Safari sends the drop's
      // beforeinput before the input of the drag that removed the text, so
      // the edit keeps the text from before the move.
      if (e.inputType === 'insertFromDrop' && beforeInput.current?.inputType === 'deleteByDrag') return
      beforeInput.current = { inputType: e.inputType, before: snapshot(node) }
    }
    node.addEventListener('beforeinput', listener)
    return () => node.removeEventListener('beforeinput', listener)
  }, [isEditing, onHistory])
  // Leaving the screen (the list is virtualized) ends only this segment's typing step.
  React.useEffect(() => () => sealTyping(s.id), [sealTyping, s.id])
  // The caret in the textarea while editing; the split button follows it.
  const [caret, setCaret] = React.useState<number | null>(null)
  const caretRef = React.useRef<number | null>(null)
  const trackCaret = (at: number) => {
    caretRef.current = at
    setCaret(at)
  }
  // The field's text as the user last left it: as it opened, or as typed.
  const typedRef = React.useRef<string | null>(null)

  React.useLayoutEffect(() => {
    if (!isEditing) return

    const node = textAreaRef.current
    if (!node) return

    autosize(node)
    // The editing identity is the caret and the focus ring, so entering edit
    // mode must hand focus over; caret goes to the end (or where a split or
    // undo put it), scroll stays put. The caret is placed first so the focus
    // handler reads it.
    const hint = caretHint(s.id)
    const end = node.value.length
    node.setSelectionRange(Math.min(hint?.start ?? end, end), Math.min(hint?.end ?? end, end))
    if (hint) hintSequence.current = hint.seq
    node.focus({ preventScroll: true })
    typedRef.current = node.value
    // Re-fit on width changes only; reacting to our own height writes would loop.
    let lastWidth = node.clientWidth
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === lastWidth) return
      lastWidth = node.clientWidth
      autosize(node)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [isEditing, s.id, caretHint])
  // Fit the field to its text on every change, typed or not: an undo, a reload
  // or a replace changes it without an input event. A change from outside also
  // moves the browser's caret to the end, so put it back where the user had it,
  // or where an undo or redo says the change was.
  React.useLayoutEffect(() => {
    const node = textAreaRef.current
    if (!isEditing || !node) return
    autosize(node)
    const hint = caretHint(s.id)
    if (hint && hint.seq !== hintSequence.current) {
      hintSequence.current = hint.seq
      node.setSelectionRange(Math.min(hint.start, text.length), Math.min(hint.end, text.length))
      node.focus({ preventScroll: true })
      trackCaret(node.selectionStart)
      selection.current = { start: node.selectionStart, end: node.selectionEnd }
      typedRef.current = text
      return
    }
    if (text === typedRef.current) return
    typedRef.current = text
    if (document.activeElement === node && caretRef.current !== null) {
      const at = Math.min(caretRef.current, text.length)
      node.setSelectionRange(at, at)
    }
  }, [isEditing, text, caretHint, s.id])
  const splitAtCaret = () => {
    const node = textAreaRef.current
    if (node && !composition.current) onSplit(s.id, node.value, node.selectionStart)
  }
  const focus = () => textAreaRef.current?.focus({ preventScroll: true })
  const handlers = {
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement>) => trackCaret(e.currentTarget.selectionStart),
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const node = e.currentTarget
      // A selection the last edit didn't leave is a caret move.
      if (selection.current && (selection.current.start !== node.selectionStart || selection.current.end !== node.selectionEnd)) sealTyping(s.id)
      selection.current = { start: node.selectionStart, end: node.selectionEnd }
      trackCaret(node.selectionStart)
    },
    onPointerDown: () => sealTyping(s.id),
    onDragEnd: () => endDrag?.(),
    onBlur: () => sealTyping(s.id),
    onCompositionStart: (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      const before = snapshot(e.currentTarget)
      composition.current = { base: s, before, invalidated: false }
      completedComposition.current = null
      setPreview({ base: s, text: before.text })
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      const active = composition.current
      if (!active) return
      composition.current = null
      beforeInput.current = null
      const after = snapshot(e.currentTarget)
      completedComposition.current = { text: after.text, data: e.data }
      window.clearTimeout(compositionEndTimer.current)
      compositionEndTimer.current = window.setTimeout(() => { completedComposition.current = null }, 0)
      setPreview(null)
      if (active.invalidated || !matchesBase(getCurrentSegment(s.id), active.base) || after.text === active.before.text) return
      selection.current = { start: after.start, end: after.end }
      typedRef.current = after.text
      onTextInput(s.id, { inputType: 'insertCompositionText', before: active.before, after, composition: true })
      scheduleSave(s.id, after.text)
    },
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const after = snapshot(e.currentTarget)
      const native = e.nativeEvent as InputEvent
      const captured = beforeInput.current
      beforeInput.current = null
      const active = composition.current
      if (active?.invalidated) return
      const completed = completedComposition.current
      if (!active && (native.isComposing || native.inputType?.includes('Composition') ||
          completed?.text === after.text ||
          (native.inputType === 'insertText' && native.data && native.data === completed?.data))) return

      selection.current = { start: after.start, end: after.end }
      typedRef.current = after.text
      if (active) {
        setPreview({ base: active.base, text: after.text })
        return
      }

      const input = captured ?? {
        inputType: native.inputType || 'edit',
        before: { text, start: caretRef.current ?? text.length, end: caretRef.current ?? text.length },
      }
      onTextInput(s.id, { ...input, after })
      scheduleSave(s.id, after.text)
    },
    onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const action = undoShortcut(e.nativeEvent)
      if (action) {
        e.preventDefault()
        onHistory(action)
        return
      }
      if (CARET_KEYS.has(e.key)) sealTyping(s.id)
      const ime = !!composition.current || e.nativeEvent.isComposing || e.keyCode === 229
      if (e.key === 'Escape' && !ime) {
        e.preventDefault()
        setEditingId(null)
        cardRef.current?.focus()
        return
      }
      // Shift+Enter breaks the line and the input method handles its own Enter.
      if (e.key === 'Enter' && !ime && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        splitAtCaret()
      }
    },
  }
  return { ref: textAreaRef, text, caret, splitAtCaret, isComposing: composing, focus, handlers }
}
