import { act, renderHook, waitFor } from '@testing-library/react'
import { useTextHistory } from '@/app/editor/[id]/hooks/useTextHistory'
import { useEditorHistory } from '@/app/editor/[id]/hooks/useEditorHistory'
import { useEditorWriteQueue } from '@/app/editor/[id]/hooks/useEditorWriteQueue'
import { useSegmentHolds } from '@/app/editor/[id]/hooks/useSegmentHolds'
import type { useTranscriptMutations } from '@/app/editor/[id]/hooks/useTranscriptMutations'
jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))
function setup() {
  let text = ''; const states: string[] = []
  const editing = { async applyTexts(edits: { before: string; after: string }[], dir: string, applied: () => void) {
    text = dir === 'undo' ? edits[0].before : edits[0].after; states.push(text); applied()
  } } as unknown as ReturnType<typeof useTranscriptMutations>
  const rendered = renderHook(() => {
    const enqueue = useEditorWriteQueue(); const holds = useSegmentHolds()
    const history = useEditorHistory({ enqueue, holds, reveal: () => {}, refresh: async () => true, isReconnecting: () => false, reconnecting: false })
    return { history, typing: useTextHistory(history, editing) }
  })
  const input = (next: string, inputType = 'insertText', composition = false, selection?: { start: number; end: number }) => act(() => {
    rendered.result.current.typing.onTextInput('x', { inputType, composition,
      before: { text, start: selection?.start ?? text.length, end: selection?.end ?? text.length },
      after: { text: next, start: next.length, end: next.length } }); text = next
  })
  const undo = async () => {
    const length = states.length; act(() => rendered.result.current.history.undo())
    await waitFor(() => expect(states).toHaveLength(length + 1))
  }
  return { ...rendered, input, undo, states, getText: () => text }
}
it('300 typed characters undo as 44, 128, 128 across input events', async () => {
  const h = setup()
  for (let i = 1; i <= 300; i++) h.input('a'.repeat(i))
  await h.undo(); await h.undo(); await h.undo()
  expect(h.states.map(t => t.length)).toEqual([256, 128, 0])
})
it('each Backspace is its own step, followed by a new typing run', async () => {
  const h = setup(); h.input('Abcdef'); h.input('Abcde', 'deleteContentBackward'); h.input('Abcd', 'deleteContentBackward'); h.input('Abcdgh')
  await h.undo(); await h.undo(); await h.undo(); await h.undo()
  expect(h.states).toEqual(['Abcd', 'Abcde', 'Abcdef', ''])
})
it('caret movement seals typing; line breaks and pauses do not', async () => {
  const h = setup(); h.input('abc'); h.input('abc\n', 'insertLineBreak'); h.input('abc\ndef')
  act(() => h.result.current.typing.seal()); h.input('abc\ndefg')
  await h.undo(); await h.undo(); expect(h.states).toEqual(['abc\ndef', ''])
})
it('compositions remain indivisible and cancellation creates no step', async () => {
  const h = setup(); h.input('', 'insertCompositionText', true); expect(h.result.current.history.canUndo).toBe(false)
  h.input('字'.repeat(150), 'insertCompositionText', true); await h.undo(); expect(h.getText()).toBe('')
})
it('a selection replacement and subsequent typing are distinct steps', async () => {
  const h = setup(); h.input('abc'); h.input('z', 'insertText', false, { start: 0, end: 3 }); h.input('zy')
  await h.undo(); await h.undo(); expect(h.states).toEqual(['z', 'abc'])
})
it('a card leaving the screen ends only its own segment\'s typing step', async () => {
  const h = setup(); h.input('abc')
  act(() => h.result.current.typing.seal('another segment'))
  h.input('abcd')
  act(() => h.result.current.typing.seal('x'))
  h.input('abcde')
  await h.undo(); await h.undo()
  expect(h.states).toEqual(['abcd', ''])
})
it('a paste and a cut are each their own step', async () => {
  const h = setup(); h.input('abc'); h.input('abc pasted', 'insertFromPaste'); h.input('abc', 'deleteByCut')
  await h.undo(); await h.undo(); await h.undo()
  expect(h.states).toEqual(['abc pasted', 'abc', ''])
})
it('Replace All is one step across segments, labelled as such', () => {
  const h = setup()
  act(() => h.result.current.typing.recordReplace([
    { segId: 'a', before: 'cat', after: 'dog' }, { segId: 'b', before: 'cats', after: 'dogs' },
  ], undefined, true))
  expect(h.result.current.history.undoLabel).toBe('replace all')
})
