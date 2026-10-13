import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import TranscriptSegmentCard, { type TranscriptSegmentCardProps } from '@/app/editor/[id]/components/TranscriptSegmentCard'
import { createPlaybackClock } from '@/app/editor/[id]/playbackClock'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Seg } from '@/app/editor/[id]/types'

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

  it('opens with the caret where a split put it', () => {
    const { textarea } = setup({ caretHint: (id) => (id === 's1' ? 0 : undefined) })
    expect(textarea.selectionStart).toBe(0)
    expect(document.activeElement).toBe(textarea)
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
          onSplit={jest.fn()} caretHint={() => undefined}
        />
      </TooltipProvider>
    )
    expect(screen.queryByRole('button', { name: 'Split segment here' })).toBeNull()
  })
})
