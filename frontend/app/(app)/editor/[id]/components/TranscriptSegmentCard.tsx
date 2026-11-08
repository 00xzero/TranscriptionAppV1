import React from 'react'
import { Pencil, Scissors, X } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { alignTokens, type SourceWord } from '@/core/transcript/word-alignment'
import { findSplit } from '@/core/transcript/segment-split'
import type { PlaybackClock } from '../playbackClock'
import type { Seg, SegmentMatch, SaveStatus } from '../types'
import { useCurrentWordIndex } from '../hooks/useCurrentWordIndex'
import type { BusyKind } from '../hooks/useSegmentHolds'
import type { CaretHint } from '../hooks/useTranscriptMutations'
import type { TextInput } from '@/core/editor/typing-steps'
import { useSegmentTextInput } from '../hooks/useSegmentTextInput'
import { formatElapsedTime } from '@/lib/utils'

type SpeakerFields = {
  speakerLabel: string
  speakerColor: string
  speakerAvatar: string
  speakerOrganisation: string | null
}

type SegmentHeaderRowProps = SpeakerFields & {
  showSpeaker: boolean
  timestamp: string
  saveStatus: SaveStatus | undefined
  busy: BusyKind | undefined
  /** A write about to change this segment is waiting: its speaker can't be changed meanwhile. */
  locked: boolean
  segmentId: string
  isEditing: boolean
  /** Whether the caret is at a place the segment can split; the button shows only while editing. */
  canSplit: boolean
  onSplitClick: () => void
  onSpeakerClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
}

// A pending write shows no status of its own; the save status shows instead.
const BUSY_LABEL: Record<BusyKind, string | null> = {
  splitting: 'Splitting…',
  undoing: 'Undoing…',
  pending: null,
}

function SegmentHeaderRow({
  showSpeaker,
  speakerLabel,
  speakerColor,
  speakerAvatar,
  speakerOrganisation,
  timestamp,
  saveStatus,
  busy,
  locked,
  segmentId,
  isEditing,
  canSplit,
  onSplitClick,
  onSpeakerClick,
  setEditingId,
}: SegmentHeaderRowProps) {
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
                <Avatar color={speakerColor}>{speakerAvatar}</Avatar>
                {speakerLabel}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{speakerOrganisation ? `${speakerLabel} · ${speakerOrganisation}` : 'Click to change speaker'}</TooltipContent>
        </Tooltip>
      )}
      <span className="font-mono text-[10px] text-ink/40 dark:text-paper/30">{timestamp}</span>
      <span className="text-[10px] font-mono">
        {busy && BUSY_LABEL[busy] ? (
          <span className="text-trust-blue">{BUSY_LABEL[busy]}</span>
        ) : (
          <>
            {saveStatus === 'saving' && <span className="text-trust-blue">Saving…</span>}
            {saveStatus === 'saved' && <span className="text-emerald-600">Saved</span>}
            {saveStatus === 'error' && <span className="text-ember-red">Save failed</span>}
          </>
        )}
      </span>
      {isEditing && (
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
            className={`${isEditing ? '' : 'ml-auto '}p-1 rounded-md hover:bg-ink/10 dark:hover:bg-paper/10 transition-opacity ${isEditing ? 'opacity-100 text-trust-blue' : 'opacity-0 group-hover:opacity-60'}`}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation()
              // Let the native IME finish on the original field before React
              // removes it. Safari needn't focus a button on pointer down.
              const active = document.activeElement
              if (active instanceof HTMLTextAreaElement && active.closest('[data-segment-id]')) active.blur()
              setEditingId((prev: string | null) => (prev === segmentId ? null : segmentId))
            }}
            aria-label={isEditing ? `Close text editor for ${speakerLabel}` : `Edit transcript text for ${speakerLabel}`}
          >
            {/* Both icons occupy the same box; the active one twists in as the other
                twists out, so toggling edit mode reads as one gesture. */}
            <span className="relative block w-3.5 h-3.5">
              <Pencil
                className={`absolute inset-0 h-full w-full transition-all duration-200 ease-out motion-reduce:transition-none ${isEditing ? 'opacity-0 rotate-45 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
                aria-hidden
              />
              <X
                className={`absolute inset-0 h-full w-full transition-all duration-200 ease-out motion-reduce:transition-none ${isEditing ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-45 scale-75'}`}
                aria-hidden
              />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{isEditing ? 'Close editor' : 'Edit text'}</TooltipContent>
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

export type TranscriptSegmentCardProps = SpeakerFields & {
  segment: Seg
  /** The engine's words for this segment; the text is aligned against them for timing. */
  sourceWords: readonly SourceWord[] | undefined
  /** Set while a write about to change this segment's text or shape waits its turn. */
  busy: BusyKind | undefined
  /** Set while any write about to change this segment waits, or the editor is reconnecting: its speaker can't be changed, nor the segment split, meanwhile. */
  locked: boolean
  /** The current segment; its words also follow playback, unless it is being edited. */
  isActive: boolean
  playbackClock: PlaybackClock
  matchesForSeg: readonly SegmentMatch[]
  matchIndex: number
  needHeader: boolean
  isEditing: boolean
  saveStatus: SaveStatus | undefined
  onSegmentClick: (segId: string, ms: number) => void
  onWordClick: (segId: string, ms: number) => void
  onSpeakerClick: (e: React.MouseEvent, segmentId: string, speakerId: string | null) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  getCurrentSegment: (segId: string) => Seg | undefined
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
  /** A drag from this field ended, wherever its text was dropped. */
  endDrag?: () => void
  /** Undo or redo in the editor's history. */
  onHistory: (dir: 'undo' | 'redo') => void
}

function TranscriptSegmentCard({
  segment: s,
  sourceWords,
  busy,
  locked,
  isActive,
  playbackClock,
  matchesForSeg,
  matchIndex,
  speakerLabel,
  speakerColor,
  speakerAvatar,
  speakerOrganisation,
  needHeader,
  isEditing,
  saveStatus,
  onSegmentClick,
  onWordClick,
  onSpeakerClick,
  setEditingId,
  getCurrentSegment,
  scheduleSave,
  onSplit,
  caretHint,
  flashing,
  onTextInput,
  sealTyping,
  endDrag,
  onHistory,
}: TranscriptSegmentCardProps) {
  // Where keyboard focus returns when Escape closes the editor.
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const { ref: textAreaRef, text, caret, splitAtCaret, isComposing, focus, handlers } = useSegmentTextInput({
    segment: s, isEditing, cardRef, caretHint, setEditingId, getCurrentSegment,
    onTextInput, scheduleSave, sealTyping, endDrag, onHistory, onSplit,
  })
  // Align the field's current text so the split button follows the caret.
  const tokens = React.useMemo(
    () => alignTokens(text, sourceWords ?? [], s.start_ms, s.end_ms),
    [text, sourceWords, s.start_ms, s.end_ms]
  )
  const canSplit = isEditing && !isComposing && !busy && !locked && caret !== null &&
    findSplit(tokens, sourceWords ?? [], text, caret, s.start_ms) !== null
  // The playing-word highlight is exact or off per segment: it runs only where
  // the segment has the engine's stored words to align against. Inside such a
  // segment, edited text follows the alignment by design, so a word typed in
  // where the engine heard nothing is placed in the gap it sits in and can be
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
        if (isEditing) focus()
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
        style={{ backgroundColor: speakerColor }}
      />

      <div className="flex-1 min-w-0">
        <SegmentHeaderRow
          // While editing, the name shows even mid-turn, so the new half of a
          // split can take its speaker straight away.
          showSpeaker={needHeader || isEditing}
          speakerLabel={speakerLabel}
          speakerColor={speakerColor}
          speakerAvatar={speakerAvatar}
          speakerOrganisation={speakerOrganisation}
          timestamp={formatElapsedTime(s.start_ms)}
          saveStatus={saveStatus}
          busy={busy}
          locked={locked}
          segmentId={s.id}
          isEditing={isEditing}
          canSplit={canSplit}
          onSplitClick={splitAtCaret}
          onSpeakerClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            onSpeakerClick(e, s.id, s.speaker_id ?? null)
          }}
          setEditingId={setEditingId}
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
            {...handlers}
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

export default React.memo(TranscriptSegmentCard)
