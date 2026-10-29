import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import TranscriptSegmentCard, { type TranscriptSegmentCardProps } from '@/app/(app)/editor/[id]/components/TranscriptSegmentCard'
import { useEditorKeyboardShortcuts } from '@/app/(app)/editor/[id]/hooks/useEditorKeyboardShortcuts'
import { createPlaybackClock } from '@/app/(app)/editor/[id]/playbackClock'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Seg } from '@/app/(app)/editor/[id]/types'

const TEXT = 'Hello there, friend.'
const segment: Seg = {
  id: 's1', transcript_id: 't1', speaker_id: null, diarization_index: null,
  start_ms: 1000, end_ms: 3000, text: TEXT,
  is_edited: false, is_filler: false, algo_version: 'test', revision: 0,
  created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
}
const sourceWords = [
  { id: 'w1', text: 'Hello', startMs: 1000, endMs: 1300 },
  { id: 'w2', text: 'there,', startMs: 1500, endMs: 1900 },
  { id: 'w3', text: 'friend.', startMs: 2200, endMs: 3000 },
]

function setup(overrides: Partial<TranscriptSegmentCardProps> = {}) {
  const props: TranscriptSegmentCardProps = {
    segment,
    sourceWords,
    busy: undefined,
    locked: false,
    isActive: false,
    playbackClock: createPlaybackClock(),
    matchesForSeg: [],
    matchIndex: -1,
    speaker: { label: 'Speaker 1', identityKey: 'sp1', color: '#4F638C', avatarText: 'S1', organisation: null },
    needHeader: false,
    editingId: 's1',
    editingTexts: { s1: TEXT },
    saveStatus: {},
    onSegmentClick: jest.fn(),
    onWordClick: jest.fn(),
    onSpeakerClick: jest.fn(),
    setEditingId: jest.fn(),
    setEditingTexts: jest.fn(),
    scheduleSave: jest.fn(),
    onSplit: jest.fn(),
    caretHint: () => undefined,
    flashing: false,
    onTextInput: jest.fn(),
    sealTyping: jest.fn(),
    onHistory: jest.fn(),
    ...overrides,
  }
  const view = render(<TooltipProvider><TranscriptSegmentCard {...props} /></TooltipProvider>)
  const rerender = (next: Partial<TranscriptSegmentCardProps>) =>
    view.rerender(<TooltipProvider><TranscriptSegmentCard {...props} {...next} /></TooltipProvider>)
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
  /** Move the caret as a user would, so the card's caret tracking sees it. */
  const placeCaret = (at: number) => {
    textarea.setSelectionRange(at, at)
    fireEvent.keyUp(textarea, { key: 'ArrowLeft' })
  }
  const splitButton = () => screen.getByRole('button', { name: 'Split segment here' })
  return { props, textarea, placeCaret, splitButton, rerender }
}

describe('splitting from the segment editor', () => {
  it('Enter splits at the caret', () => {
    const { props, textarea, placeCaret } = setup()
    placeCaret(6)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSplit).toHaveBeenCalledWith('s1', TEXT, 6)
  })

  it('Enter never inserts a line break, even where there is nothing to split', () => {
    const { textarea } = setup()
    const event = createEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent(textarea, event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves Shift+Enter and Enter that confirms an IME composition alone', () => {
    const { props, textarea, placeCaret } = setup()
    placeCaret(6)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })
    expect(props.onSplit).not.toHaveBeenCalled()
  })

  it('offers the split button only where a split exists', () => {
    const { splitButton, placeCaret } = setup()
    // The editor opens with the caret at the end.
    expect(splitButton()).toBeDisabled()
    placeCaret(6)
    expect(splitButton()).toBeEnabled()
    placeCaret(0)
    expect(splitButton()).toBeDisabled()
  })

  it('offers no split without stored words', () => {
    const { splitButton, placeCaret } = setup({ sourceWords: [] })
    placeCaret(6)
    expect(splitButton()).toBeDisabled()
  })

  it('the split button splits at the caret, keeps focus in the text and does not seek', () => {
    const { props, textarea, placeCaret, splitButton } = setup()
    placeCaret(13)
    const mouseDown = createEvent.mouseDown(splitButton())
    fireEvent(splitButton(), mouseDown)
    expect(mouseDown.defaultPrevented).toBe(true)
    // A real click ends in mouseup; React's select tracking waits for it.
    fireEvent.mouseUp(splitButton())
    fireEvent.click(splitButton())
    expect(props.onSplit).toHaveBeenCalledWith('s1', TEXT, 13)
    expect(props.onSegmentClick).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(textarea)
  })

  it('is closed to edits and splits while busy, and says why', () => {
    const { props, textarea, placeCaret, splitButton } = setup({ busy: 'splitting' })
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.getByText('Splitting…')).toBeInTheDocument()
    placeCaret(6)
    expect(splitButton()).toBeDisabled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    // The hook turns a busy segment away too; the card still asks.
    expect(props.onSplit).toHaveBeenCalledTimes(1)
  })

  it('a waiting write closes the field without a label of its own, showing the save status instead', () => {
    const { textarea } = setup({ busy: 'pending', saveStatus: { s1: 'saving' } })
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('keeps its speaker picker closed while a write about to change it waits', () => {
    setup({ locked: true })
    expect(screen.getByRole('button', { name: 'Change speaker (Speaker 1)' })).toBeDisabled()
    // A speaker change waiting doesn't close the text.
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly')
  })

  it('opens with the caret where a split put it', () => {
    const { textarea } = setup({ caretHint: (id) => (id === 's1' ? { start: 0, end: 0, seq: 1 } : undefined) })
    expect(textarea.selectionStart).toBe(0)
    expect(document.activeElement).toBe(textarea)
  })

  it('selects what an undo restored, when its text changes from outside', () => {
    let hint: { start: number; end: number; seq: number } | undefined
    const { textarea, rerender } = setup({ caretHint: () => hint })
    hint = { start: 6, end: 11, seq: 2 }
    rerender({ editingTexts: { s1: 'Hello world, friend.' }, caretHint: () => hint })
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 11])
  })

  // Codex: an undo (or reload, or replace) changes the text without an input
  // event; the field must still fit it, without the caret jumping.
  it('fits the field to text changed from outside, keeping the caret where it was', () => {
    // jsdom has no layout: report a content height that grows with the text.
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) { return 20 + this.value.length },
    })
    try {
      const { textarea, placeCaret, rerender } = setup()
      expect(textarea.style.height).toBe(`${20 + TEXT.length}px`)
      placeCaret(5)

      const joined = `${TEXT} And the second half, joined back by an undo.`
      rerender({ editingTexts: { s1: joined } })
      expect(textarea.value).toBe(joined)
      expect(textarea.style.height).toBe(`${20 + joined.length}px`)
      expect(textarea.selectionStart).toBe(5)
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
    }
  })

  it('shows the speaker name while editing, even mid-turn', () => {
    setup({ needHeader: false })
    const speakerButton = screen.getByRole('button', { name: 'Change speaker (Speaker 1)' })
    expect(speakerButton.className).not.toContain('max-w-0')
  })

  it('has no split button when not editing', () => {
    render(
      <TooltipProvider>
        <TranscriptSegmentCard
          segment={segment} sourceWords={sourceWords} busy={undefined} isActive={false}
          playbackClock={createPlaybackClock()} matchesForSeg={[]} matchIndex={-1}
          speaker={{ label: 'Speaker 1', identityKey: 'sp1', color: '#4F638C', avatarText: 'S1', organisation: null }}
          needHeader editingId={null} editingTexts={{}} saveStatus={{}}
          onSegmentClick={jest.fn()} onWordClick={jest.fn()} onSpeakerClick={jest.fn()}
          setEditingId={jest.fn()} setEditingTexts={jest.fn()} scheduleSave={jest.fn()}
          onSplit={jest.fn()} caretHint={() => undefined} locked={false} flashing={false}
          onTextInput={jest.fn()} sealTyping={jest.fn()} onHistory={jest.fn()}
        />
      </TooltipProvider>
    )
    expect(screen.queryByRole('button', { name: 'Split segment here' })).toBeNull()
  })
})

describe('the undo history from the segment editor', () => {
  it('records each typed edit with the text and selection before and after', () => {
    const { props, textarea } = setup()
    textarea.setSelectionRange(5, 5)
    fireEvent(textarea, new InputEvent('beforeinput', { inputType: 'insertText', data: '!', bubbles: true, cancelable: true }))
    fireEvent.change(textarea, { target: { value: 'Hello! there, friend.', selectionStart: 6, selectionEnd: 6 } })
    expect(props.onTextInput).toHaveBeenCalledWith('s1', {
      inputType: 'insertText',
      before: { text: TEXT, start: 5, end: 5 },
      after: expect.objectContaining({ text: 'Hello! there, friend.' }),
    })
    expect(props.scheduleSave).toHaveBeenCalledWith('s1', 'Hello! there, friend.')
  })

  it('records a Safari text move as one edit from the text before the move', () => {
    // Safari's order: both beforeinputs, the source already removed at the second, then the input.
    const { props, textarea } = setup()
    textarea.setSelectionRange(0, 6)
    fireEvent(textarea, new InputEvent('beforeinput', { inputType: 'deleteByDrag', bubbles: true, cancelable: true }))
    textarea.value = 'there, friend.'
    fireEvent(textarea, new InputEvent('beforeinput', { inputType: 'insertFromDrop', data: 'Hello ', bubbles: true, cancelable: true }))
    fireEvent.change(textarea, { target: { value: 'there, friend.Hello ' } })
    expect(props.onTextInput).toHaveBeenCalledTimes(1)
    expect(props.onTextInput).toHaveBeenCalledWith('s1', expect.objectContaining({
      inputType: 'deleteByDrag',
      before: { text: TEXT, start: 0, end: 6 },
      after: expect.objectContaining({ text: 'there, friend.Hello ' }),
    }))
  })

  it('sends Ctrl+Z and Ctrl+Y to the history, not the field', () => {
    const { props, textarea } = setup()
    const undo = createEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
    fireEvent(textarea, undo)
    expect(undo.defaultPrevented).toBe(true)
    fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true })
    fireEvent.keyDown(textarea, { key: 'Z', metaKey: true, shiftKey: true })
    expect(jest.mocked(props.onHistory).mock.calls).toEqual([['undo'], ['redo'], ['redo']])
  })

  it('handles Ctrl+Z once, with the editor-wide shortcut also listening', () => {
    const windowUndo = jest.fn()
    function Shortcuts() {
      useEditorKeyboardShortcuts({
        togglePlay: jest.fn(), seekRelative: jest.fn(), openFindReplaceModal: jest.fn(), openExportModal: jest.fn(),
        handleReturnToTop: jest.fn(), onHistory: windowUndo,
      })
      return null
    }
    render(<Shortcuts />)
    const { props, textarea } = setup()
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
    expect(props.onHistory).toHaveBeenCalledWith('undo')
    expect(windowUndo).not.toHaveBeenCalled()
    // Outside any field, the editor-wide shortcut undoes.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(windowUndo).toHaveBeenCalledTimes(1)
  })

  it('routes the browser menu\'s undo to the history and cancels its own', () => {
    const { props, textarea } = setup()
    const menuUndo = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true })
    textarea.dispatchEvent(menuUndo)
    expect(menuUndo.defaultPrevented).toBe(true)
    expect(props.onHistory).toHaveBeenCalledWith('undo')
  })

  it('ends its typing step when the caret moves, and only its own when it leaves the screen', () => {
    const { props, textarea } = setup()
    fireEvent.keyDown(textarea, { key: 'ArrowLeft' })
    expect(props.sealTyping).toHaveBeenLastCalledWith('s1')
    ;(props.sealTyping as jest.Mock).mockClear()
    fireEvent.pointerDown(textarea)
    expect(props.sealTyping).toHaveBeenLastCalledWith('s1')
  })

  it('a card scrolling away ends only its own segment\'s typing step', () => {
    const sealTyping = jest.fn()
    const { unmount } = render(
      <TooltipProvider>
        <TranscriptSegmentCard
          segment={segment} sourceWords={sourceWords} busy={undefined} isActive={false}
          playbackClock={createPlaybackClock()} matchesForSeg={[]} matchIndex={-1}
          speaker={{ label: 'Speaker 1', identityKey: 'sp1', color: '#4F638C', avatarText: 'S1', organisation: null }}
          needHeader editingId={null} editingTexts={{}} saveStatus={{}}
          onSegmentClick={jest.fn()} onWordClick={jest.fn()} onSpeakerClick={jest.fn()}
          setEditingId={jest.fn()} setEditingTexts={jest.fn()} scheduleSave={jest.fn()}
          onSplit={jest.fn()} caretHint={() => undefined} locked={false} flashing={false}
          onTextInput={jest.fn()} sealTyping={sealTyping} onHistory={jest.fn()}
        />
      </TooltipProvider>
    )
    unmount()
    expect(sealTyping).toHaveBeenCalledWith('s1')
    expect(sealTyping).not.toHaveBeenCalledWith()
  })

  it.each([
    ['input before compositionend (Chrome)', 'inputFirst'],
    ['compositionend before input (Safari)', 'endFirst'],
  ])('records an input-method composition once, %s', (_name, order) => {
    jest.useFakeTimers()
    try {
      const { props, textarea } = setup()
      textarea.setSelectionRange(TEXT.length, TEXT.length)
      const composed = `${TEXT}日本`
      fireEvent.compositionStart(textarea)
      fireEvent.change(textarea, { target: { value: `${TEXT}にほ` } })
      if (order === 'inputFirst') {
        fireEvent.change(textarea, { target: { value: composed } })
        // The harness's texts don't update, so put back what the field holds.
        textarea.value = composed
        fireEvent.compositionEnd(textarea)
      } else {
        textarea.value = composed
        fireEvent.compositionEnd(textarea)
        fireEvent.change(textarea, { target: { value: composed } })
      }
      act(() => { jest.runOnlyPendingTimers() })
      expect(props.onTextInput).toHaveBeenCalledTimes(1)
      expect(props.onTextInput).toHaveBeenCalledWith('s1', expect.objectContaining({
        inputType: 'insertCompositionText', composition: true,
        before: expect.objectContaining({ text: TEXT }), after: expect.objectContaining({ text: composed }),
      }))
      expect(props.scheduleSave).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the edit ring while lit after an undo', () => {
    setup({ flashing: true })
    const card = screen.getByTestId('segment-card')
    expect(card.className).toContain('ring-1')
    expect(card.className).toContain('bg-warm-highlight')
  })
})
