import * as history from '@/core/editor/undo-history'
import { classifyInput, canExtend } from '@/core/editor/typing-steps'
import { stepName, typedQuote } from '@/core/editor/step-names'
import { undoShortcut } from '@/lib/editor/undoShortcut'
it('caps history, moves steps, drops originals, and clears redo on a new edit', () => {
  let h = history.emptyHistory<number>()
  for (let i = 0; i < 1001; i++) h = history.record(h, i)
  expect(h.done).toHaveLength(1000); expect(h.done[0]).toBe(1)
  const [undone, step] = history.takeUndo(h); expect(step).toBe(1000)
  expect(history.takeRedo(undone)[0].done.at(-1)).toBe(1000)
  expect(history.record(undone, 2000).undone).toEqual([])
})
it('classifies deletions, selection replacement, paste, and compositions', () => {
  expect(classifyInput('deleteContentBackward', false)).toBe('delete')
  expect(classifyInput('deleteByCut', true)).toBe('cut')
  expect(classifyInput('insertText', true)).toBe('replace')
  expect(classifyInput('insertFromPaste', false)).toBe('paste')
  expect(classifyInput('insertCompositionText', false)).toBe('typing')
  const open = { segmentId: 'x', characters: 127, version: 1, sealed: false }
  expect(canExtend(open, 'x', 'typing', 1)).toBe(true)
  expect(canExtend(open, 'x', 'replace', 1)).toBe(false)
  expect(canExtend(open, 'y', 'typing', 1)).toBe(false)
  expect(canExtend(open, 'x', 'typing', 2)).toBe(false)
  expect(canExtend({ ...open, sealed: true }, 'x', 'typing', 1)).toBe(false)
})
it('recognizes shortcuts across layouts without swallowing AltGraph or composition', () => {
  const key = { key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, getModifierState: () => false }
  expect(undoShortcut(key)).toBe('undo')
  expect(undoShortcut({ ...key, shiftKey: true })).toBe('redo')
  expect(undoShortcut({ ...key, key: 'y', code: 'KeyY' })).toBe('redo')
  expect(undoShortcut({ ...key, key: 'я' })).toBe('undo')
  expect(undoShortcut({ ...key, isComposing: true })).toBeNull()
  expect(undoShortcut({ ...key, getModifierState: () => true })).toBeNull()
})
it('names undo list steps plainly, quoting only short typing on one line', () => {
  expect(stepName('replace all')).toBe('Replace All')
  expect(stepName('drag and drop')).toBe('Drag and Drop')
  expect(stepName('typing', typedQuote('Hello', 'Hello sno'))).toBe('Typing " sno"')
  expect(typedQuote('ab', 'aXYb')).toBe('XY')
  expect(typedQuote('abc', 'ab')).toBeUndefined()
  expect(typedQuote('', 'a much longer run')).toBeUndefined()
  expect(typedQuote('a', 'a\nb')).toBeUndefined()
})
