import React from 'react'
import { Pencil, Scissors, X } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SpeakerDisplay } from '@/lib/speakers/display'
import { alignTokens, type SourceWord } from '@/core/transcript/word-alignment'
import { findSplit } from '@/core/transcript/segment-split'
import type { PlaybackClock } from '../playbackClock'
import type { Seg, SegmentMatch, SaveStatusBySegment } from '../types'
import { useCurrentWordIndex } from '../hooks/useCurrentWordIndex'
import type { BusyKind } from '../hooks/useSegmentHolds'
import type { CaretHint } from '../hooks/useTranscriptMutations'
import type { TextInput, SelectionText } from '@/core/editor/typing-steps'
import { undoShortcut } from '@/lib/editor/undoShortcut'
import { formatElapsedTime } from '@/lib/utils'

// Keeps the edit textarea exactly as tall as its content so entering edit mode
// never changes the segment's height.
function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  // scrollHeight covers content + padding, which is the whole box here: sizing is
  // border-box and the field's outline is an inset shadow, not a border. Give it a
  // real border and this under-measures by the border width, clipping the last line.
  el.style.height = `${el.scrollHeight}px`
}

type SegmentHeaderRowProps = {
  showSpeaker: boolean
  speaker: SpeakerDisplay
  timestamp: string
  saveStatus: SaveStatusBySegment
  busy: BusyKind | undefined
  /** A write about to change this segment is waiting: its speaker can't be changed meanwhile. */
  locked: boolean
  segmentId: string
  segmentText: string
  editingId: string | null
  /** Whether the caret is at a place the segment can split; the button shows only while editing. */
  canSplit: boolean
  onSplitClick: () => void
  onSpeakerClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

// A pending write shows no status of its own; the save status shows instead.
const BUSY_LABEL: Record<BusyKind, string | null> = {
  splitting: 'Splitting…',
  undoing: 'Undoing…',
  pending: null,
}

function SegmentHeaderRow({
  showSpeaker,
  speaker,
  timestamp,
  saveStatus,
  busy,
  locked,
  segmentId,
  segmentText,
  editingId,
  canSplit,
  onSplitClick,
  onSpeakerClick,
  setEditingId,
  setEditingTexts,
}: SegmentHeaderRowProps) {
  const speakerLabel = speaker.label
  const speakerButtonClassName = [
    'font-sans font-bold text-sm text-ink dark:text-paper cursor-pointer hover:text-trust-blue transition-all duration-200 ease-out motion-reduce:transition-none bg-transparent border-0 p-0 rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/40 whitespace-nowrap',
    showSpeaker
      ? ''
      : 'max-w-0 -mr-3 overflow-hidden opacity-0 -translate-x-1 pointer-events-none group-hover:max-w-48 group-hover:mr-0 group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto focus-visible:max-w-48 focus-visible:mr-0 focus-visible:opacity-100 focus-visible:translate-x-0 focus-visible:pointer-events-auto',
  ].join(' ')

  return (
    <div className="flex items-center gap-3 mb-2">
      {onSpeakerClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={speakerButtonClassName}
              onClick={onSpeakerClick}
              aria-label={`Change speaker (${speakerLabel})`}
              disabled={locked}
              aria-haspopup="dialog"
              data-speaker-trigger=""
              tabIndex={0}
            >
              <span className="inline-flex items-center gap-2">
                <Avatar color={speaker.color}>{speaker.avatarText}</Avatar>
                {speakerLabel}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{speaker.organisation ? `${speakerLabel} · ${speaker.organisation}` : 'Click to change speaker'}</TooltipContent>
        </Tooltip>
      )}
      <span className="font-mono text-[10px] text-ink/40 dark:text-paper/30">{timestamp}</span>
      <span className="text-[10px] font-mono">
        {busy && BUSY_LABEL[busy] ? (
          <span className="text-trust-blue">{BUSY_LABEL[busy]}</span>
        ) : (
          <>
            {saveStatus[segmentId] === 'saving' && <span className="text-trust-blue">Saving…</span>}
            {saveStatus[segmentId] === 'saved' && <span className="text-emerald-600">Saved</span>}
            {saveStatus[segmentId] === 'error' && <span className="text-ember-red">Save failed</span>}
          </>
        )}
      </span>
      {editingId === segmentId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="ml-auto p-1 rounded-md text-trust-blue hover:bg-ink/10 dark:hover:bg-paper/10 disabled:opacity-30 disabled:hover:bg-transparent"
              disabled={!canSplit}
              // Keep focus, and the caret, in the textarea the split reads.
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                // A click on the card seeks; this one only splits.
                e.stopPropagation()
                onSplitClick()
              }}
              aria-label="Split segment here"
            >
              <Scissors className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>Split here (Enter)</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`${editingId === segmentId ? '' : 'ml-auto '}p-1 rounded-md hover:bg-ink/10 dark:hover:bg-paper/10 transition-opacity ${editingId === segmentId ? 'opacity-100 text-trust-blue' : 'opacity-0 group-hover:opacity-60'}`}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation()
              setEditingId((prev: string | null) => (prev === segmentId ? null : segmentId))
              setEditingTexts((prev: Record<string, string>) => ({ ...prev, [segmentId]: segmentText }))
            }}
            aria-label={editingId === segmentId ? `Close text editor for ${speakerLabel}` : `Edit transcript text for ${speakerLabel}`}
          >
            {/* Both icons occupy the same box; the active one twists in as the other
                twists out, so toggling edit mode reads as one gesture. */}
            <span className="relative block w-3.5 h-3.5">
              <Pencil
                className={`absolute inset-0 h-full w-full transition-all duration-200 ease-out motion-reduce:transition-none ${editingId === segmentId ? 'opacity-0 rotate-45 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
                aria-hidden
              />
              <X
                className={`absolute inset-0 h-full w-full transition-all duration-200 ease-out motion-reduce:transition-none ${editingId === segmentId ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-45 scale-75'}`}
                aria-hidden
              />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{editingId === segmentId ? 'Close editor' : 'Edit text'}</TooltipContent>
      </Tooltip>
    </div>
  )
}

// Typography shared by the read and edit states so toggling the editor never
// reflows the text.
const SEGMENT_TEXT_TYPE = 'font-sans text-lg leading-relaxed text-ink/90 dark:text-paper/80'

// The card itself becomes the input surface while editing, so the field's padding is
// the card's own padding and nothing has to be inset or bled to line up. It reads as a
// well in the same material as the page: a hairline border that only takes the accent
// while the field is focused, and the house elevation shadow — the editing identity
// comes from the caret, not from a loud outline. The well's fill is separate (below)
// because it doubles as the playback indicator.
const SEGMENT_EDIT_SURFACE =
  'ring-1 ring-border focus-within:ring-accent/40 shadow-elevation dark:shadow-none'

// Fill for the editing well. At rest it is `control` (the field color at resting
// alpha, so the white stays warmed by the paper beneath). While playback is inside
// this segment it takes `accent-soft` — the same trust-blue wash every active card
// wears — so the audio position stays legible through the edit session.
const SEGMENT_EDIT_FILL_RESTING = 'bg-control'
const SEGMENT_EDIT_FILL_ACTIVE = 'bg-accent-soft'

// Brief fill after an undo or redo changed the segment. While editing it
// replaces only the fill, so the edit ring stays.
const SEGMENT_FLASH = 'bg-warm-highlight dark:bg-warm-highlight/15'

// Keys that move the caret, which ends a typing step as in Word.
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

// The textarea carries no box of its own: same width, zero padding, no border, so the
// text sits exactly where the read view painted it.
const SEGMENT_EDIT_FIELD =
  'block w-full p-0 resize-none overflow-hidden bg-transparent caret-accent outline-hidden'

// Playing-word highlight in the segment the audio is in: spoken words keep the
// text color, the current word takes ember, upcoming words fall well back so the
// boundary reads at a glance. The current word is emboldened with a hairline
// stroke rather than font-weight: a heavier weight is wider and would reflow the
// line every time the highlight moved.
const WORD_TRANSITION = 'transition-colors duration-150 motion-reduce:transition-none'
const WORD_CURRENT = 'text-ember-red [-webkit-text-stroke:0.45px_currentColor]'
const WORD_UPCOMING = 'text-foreground/30 dark:text-foreground/25'

function playbackWordClass(index: number, currentIndex: number | null): string {
  if (currentIndex === null || index < currentIndex) return WORD_TRANSITION
  return `${WORD_TRANSITION} ${index === currentIndex ? WORD_CURRENT : WORD_UPCOMING}`
}

export type TranscriptSegmentCardProps = {
  segment: Seg
  /** Deepgram's words for this segment; the text is aligned against them for timing. */
  sourceWords: readonly SourceWord[] | undefined
  /** Set while a write about to change this segment's text or shape waits its turn. */
  busy: BusyKind | undefined
  /** Set while any write about to change this segment waits: its speaker can't be changed meanwhile. */
  locked: boolean
  /** The current segment; its words also follow playback, unless it is being edited. */
  isActive: boolean
  playbackClock: PlaybackClock
  matchesForSeg: SegmentMatch[]
  matchIndex: number
  speaker: SpeakerDisplay
  needHeader: boolean
  editingId: string | null
  editingTexts: Record<string, string>
  saveStatus: SaveStatusBySegment
  onSegmentClick: (segId: string, ms: number) => void
  onWordClick: (segId: string, ms: number) => void
  onSpeakerClick: (e: React.MouseEvent, segmentId: string, speakerId: string | null) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  scheduleSave: (segId: string, newText: string) => void
  onSplit: (segId: string, text: string, caret: number) => void
  /** Where the caret (or selection) goes when this card's editor opens, or its text changes from outside. */
  caretHint: (segId: string) => CaretHint | undefined
  /** Briefly lit after an undo or redo changed it. */
  flashing: boolean
  /** Reports each edit typed into the field, with the text and selection before and after, for the history. */
  onTextInput: (segId: string, input: TextInput) => void
  /** Ends this segment's open typing step, as moving the caret does in Word. */
  sealTyping: (segId: string) => void
  /** Undo or redo in the editor's history. */
  onHistory: (dir: 'undo' | 'redo') => void
}

export default function TranscriptSegmentCard({
  segment: s,
  sourceWords,
  busy,
  locked,
  isActive,
  playbackClock,
  matchesForSeg,
  matchIndex,
  speaker,
  needHeader,
  editingId,
  editingTexts,
  saveStatus,
  onSegmentClick,
  onWordClick,
  onSpeakerClick,
  setEditingId,
  setEditingTexts,
  scheduleSave,
  onSplit,
  caretHint,
  flashing,
  onTextInput,
  sealTyping,
  onHistory,
}: TranscriptSegmentCardProps) {
  const isEditing = editingId === s.id
  const speakerLabel = speaker.label
  // Where keyboard focus returns when Escape closes the editor.
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null)
  // The edit about to happen, from the field's native beforeinput: its kind,
  // and the text and selection it starts from.
  const beforeInput = React.useRef<{ inputType: string; before: SelectionText } | null>(null)
  // The text and selection an input-method composition started from, while one runs.
  const composition = React.useRef<SelectionText | null>(null)
  // The text the last composition ended on: some browsers fire its final input
  // after compositionend, and that edit is already recorded.
  const composedText = React.useRef<string | null>(null)
  // The caret hint last applied, so each is applied once.
  const hintSequence = React.useRef(-1)
  // The selection as the last edit left it; a change from that is a caret move.
  const selection = React.useRef<{ start: number; end: number } | null>(null)
  const snapshot = (node: HTMLTextAreaElement): SelectionText => ({ text: node.value, start: node.selectionStart, end: node.selectionEnd })
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
  // Mounted cards only (the list is virtualized); re-aligns whenever the text
  // changes. While editing it aligns the text being typed, which the split
  // button and Enter cut.
  const text = isEditing ? (editingTexts[s.id] ?? s.text) : s.text
  const tokens = React.useMemo(
    () => alignTokens(text, sourceWords ?? [], s.start_ms, s.end_ms),
    [text, sourceWords, s.start_ms, s.end_ms]
  )
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
  const canSplit = isEditing && !busy && caret !== null &&
    findSplit(tokens, sourceWords ?? [], text, caret, s.start_ms) !== null
  const splitAtCaret = () => {
    const node = textAreaRef.current
    if (node) onSplit(s.id, node.value, node.selectionStart)
  }
  // The playing-word highlight is exact or off per segment: it runs only where
  // the segment has Deepgram's stored words to align against. Inside such a
  // segment, edited text follows the alignment by design, so a word typed in
  // where Deepgram heard nothing is placed in the gap it sits in and can be
  // current. Without stored words the tokens are only an even spread across the
  // segment: enough to aim a click, as before word timings existed, but never
  // shown as playback.
  const hasWordTimings = (sourceWords?.length ?? 0) > 0
  const currentWordIndex = useCurrentWordIndex({
    tokens,
    enabled: isActive && !isEditing && hasWordTimings,
    clock: playbackClock,
  })
  const sortedMatches = matchesForSeg.slice().sort((a, b) => a.index - b.index)
  // Tracks the cumulative character offset used with sortedMatches/matchIndex while mapping content and onWordClick spans.
  let charCursor = 0

  return (
    <div
      ref={cardRef}
      data-testid="segment-card"
      data-segment-id={s.id}
      className={`group rounded-xl cursor-pointer flex gap-3 transition-[background-color,box-shadow] motion-reduce:transition-none ${needHeader ? 'p-3 mt-4' : 'py-2 px-3'} ${isEditing ? `${SEGMENT_EDIT_SURFACE} ${flashing ? SEGMENT_FLASH : isActive ? SEGMENT_EDIT_FILL_ACTIVE : SEGMENT_EDIT_FILL_RESTING}` : flashing ? SEGMENT_FLASH : isActive ? 'bg-trust-blue/10 dark:bg-trust-blue/15' : 'hover:bg-subtle'}`}
      onClick={() => {
        onSegmentClick(s.id, s.start_ms)
        // Clicking the card chrome always syncs playback, editing or not — but a
        // click outside the textarea blurs it, so hand focus straight back to keep
        // the edit session (ring, caret) alive across the seek.
        if (isEditing) textAreaRef.current?.focus({ preventScroll: true })
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSegmentClick(s.id, s.start_ms)
        }
      }}
      // While editing, the card is chrome around a textarea, not a playback button:
      // announcing it as one would wrap the field in a phantom control for screen
      // readers, so the role and label lift for the duration of the edit session.
      role={isEditing ? undefined : 'button'}
      tabIndex={isEditing ? -1 : 0}
      aria-label={isEditing ? undefined : `Jump playback to ${formatElapsedTime(s.start_ms)} for ${speakerLabel}`}
    >
      <div
        className={`shrink-0 self-stretch rounded-full transition-all ${isActive ? 'w-1.5 shadow-xs' : 'w-1 opacity-60'}`}
        style={{ backgroundColor: speaker.color }}
      />

      <div className="flex-1 min-w-0">
        <SegmentHeaderRow
          // While editing, the name shows even mid-turn, so the new half of a
          // split can take its speaker straight away.
          showSpeaker={needHeader || isEditing}
          speaker={speaker}
          timestamp={formatElapsedTime(s.start_ms)}
          saveStatus={saveStatus}
          busy={busy}
          locked={locked}
          segmentId={s.id}
          segmentText={s.text}
          editingId={editingId}
          canSplit={canSplit}
          onSplitClick={splitAtCaret}
          onSpeakerClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onSpeakerClick(e, s.id, s.speaker_id ?? null)
          }}
          setEditingId={setEditingId}
          setEditingTexts={setEditingTexts}
        />
        {isEditing ? (
          <textarea
            ref={textAreaRef}
            // The default rows={2} puts a floor under scrollHeight, so autosize
            // renders one-line segments two lines tall. rows={1} lets the fit be exact.
            rows={1}
            className={`${SEGMENT_TEXT_TYPE} ${SEGMENT_EDIT_FIELD}`}
            value={text}
            // Closed to edits while a split or undo waits on the database.
            readOnly={!!busy}
            onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => trackCaret(e.currentTarget.selectionStart)}
            onSelect={(e: React.SyntheticEvent<HTMLTextAreaElement>) => {
              const node = e.currentTarget
              // A selection the last edit didn't leave is a caret move.
              if (selection.current && (selection.current.start !== node.selectionStart || selection.current.end !== node.selectionEnd)) sealTyping(s.id)
              selection.current = { start: node.selectionStart, end: node.selectionEnd }
              trackCaret(node.selectionStart)
            }}
            onPointerDown={() => sealTyping(s.id)}
            onBlur={() => sealTyping(s.id)}
            onCompositionStart={(e: React.CompositionEvent<HTMLTextAreaElement>) => { composition.current = snapshot(e.currentTarget) }}
            onCompositionEnd={(e: React.CompositionEvent<HTMLTextAreaElement>) => {
              // A composition is one edit, recorded here whichever order the
              // browser fires this and its last input event in.
              const before = composition.current
              composition.current = null
              const after = snapshot(e.currentTarget)
              composedText.current = after.text
              window.setTimeout(() => { composedText.current = null }, 0)
              if (before) onTextInput(s.id, { inputType: 'insertCompositionText', before, after, composition: true })
              scheduleSave(s.id, after.text)
            }}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              const value = e.target.value
              // Typed: the caret is already where the user put it. The fit
              // follows from the effect above.
              const after = snapshot(e.currentTarget)
              selection.current = { start: after.start, end: after.end }
              // During a composition, and for its last input once it has ended,
              // compositionend records and saves.
              const composed = composition.current !== null || composedText.current === value
              if (!composed) {
                const input = beforeInput.current ?? { inputType: (e.nativeEvent as InputEvent).inputType || 'edit', before: { text, start: caretRef.current ?? text.length, end: caretRef.current ?? text.length } }
                onTextInput(s.id, { ...input, after })
              }
              beforeInput.current = null
              typedRef.current = value
              setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.id]: value }))
              if (!composed) scheduleSave(s.id, value)
            }}
            onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation()}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              // Undo and redo are the editor's, not the field's own.
              const action = undoShortcut(e.nativeEvent)
              if (action) {
                e.preventDefault()
                onHistory(action)
                return
              }
              if (CARET_KEYS.has(e.key)) sealTyping(s.id)
              // Escape ends the edit session (edits already saved via scheduleSave)
              // and returns keyboard focus to the card, mirroring the X button.
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditingId(null)
                cardRef.current?.focus()
                return
              }
              // Enter splits at the caret; Shift+Enter still breaks the line,
              // and Enter that confirms an IME composition is left alone.
              if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey &&
                  !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                splitAtCaret()
              }
            }}
            aria-label={`Transcript text for ${speakerLabel} at ${formatElapsedTime(s.start_ms)}`}
          />
        ) : (
          <div className={SEGMENT_TEXT_TYPE}>
            {(tokens.length ? tokens : [{ startMs: s.start_ms, endMs: s.end_ms, text: s.text }]).map((w, wordIndex) => {
              const wordKey = `${s.id}:${wordIndex}`
              const wordText = w.text
              const wordStart = charCursor
              const wordEnd = wordStart + wordText.length
              let content: React.ReactNode
              const overlapping = sortedMatches.filter((m) => m.index < wordEnd && (m.index + m.length) > wordStart)
              if (overlapping.length === 0) {
                content = <>{wordText}</>
              } else {
                let localPos = 0
                const pieces: React.ReactNode[] = []
                overlapping.forEach((m, idx2) => {
                  const startIdx = Math.max(0, m.index - wordStart)
                  const endIdx = Math.min(wordText.length, m.index + m.length - wordStart)
                  if (startIdx > localPos) {
                    pieces.push(<span key={`n-${m.matchIdx}-${idx2}-${startIdx}`}>{wordText.slice(localPos, startIdx)}</span>)
                  }
                  const highlight = wordText.slice(startIdx, endIdx)
                  pieces.push(
                    <span key={`h-${m.matchIdx}-${idx2}`} className={`${m.matchIdx === matchIndex ? 'bg-warm-highlight text-ink outline-solid outline-2 outline-ember-red dark:bg-trust-blue dark:text-solid-foreground dark:outline-ember-red' : 'bg-warm-highlight text-ink dark:bg-trust-blue dark:text-solid-foreground'}`}>{highlight}</span>
                  )
                  localPos = endIdx
                })
                if (localPos < wordText.length) {
                  pieces.push(<span key={`t-${wordKey}-${localPos}`}>{wordText.slice(localPos)}</span>)
                }
                content = <>{pieces}</>
              }
              charCursor = wordEnd
              return (
                <span
                  key={wordKey}
                  className={playbackWordClass(wordIndex, currentWordIndex)}
                  onClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                    e.stopPropagation()
                    onWordClick(s.id, w.startMs)
                  }}
                >
                  {content}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
