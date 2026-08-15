import React from 'react'
import { Pencil, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Word, Seg, SegmentMatch, SaveStatusBySegment } from '../types'
import { msToTimestamp } from '../utils'

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
  speakerLabel: string
  timestamp: string
  saveStatus: SaveStatusBySegment
  segmentId: string
  segmentText: string
  editingId: string | null
  onSpeakerClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function SegmentHeaderRow({
  showSpeaker,
  speakerLabel,
  timestamp,
  saveStatus,
  segmentId,
  segmentText,
  editingId,
  onSpeakerClick,
  setEditingId,
  setEditingTexts,
}: SegmentHeaderRowProps) {
  const speakerButtonClassName = [
    'font-sans font-bold text-sm text-ink dark:text-paper cursor-pointer hover:text-trust-blue transition-all duration-200 ease-out motion-reduce:transition-none bg-transparent border-0 p-0 rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/40 whitespace-nowrap',
    showSpeaker
      ? ''
      : 'max-w-0 -mr-3 overflow-hidden opacity-0 -translate-x-1 pointer-events-none group-hover:max-w-48 group-hover:mr-0 group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto focus-visible:max-w-48 focus-visible:mr-0 focus-visible:opacity-100 focus-visible:translate-x-0 focus-visible:pointer-events-auto',
  ].join(' ')

  return (
    <div className="flex items-baseline gap-3 mb-2">
      {onSpeakerClick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={speakerButtonClassName}
              onClick={onSpeakerClick}
              aria-label={`Change speaker (${speakerLabel})`}
              aria-haspopup="dialog"
              tabIndex={0}
            >
              {speakerLabel}
            </button>
          </TooltipTrigger>
          <TooltipContent>Click to change speaker</TooltipContent>
        </Tooltip>
      )}
      <span className="font-mono text-[10px] text-ink/40 dark:text-paper/30">{timestamp}</span>
      <span className="text-[10px] font-mono">
        {saveStatus[segmentId] === 'saving' && <span className="text-trust-blue">Saving…</span>}
        {saveStatus[segmentId] === 'saved' && <span className="text-emerald-600">Saved</span>}
        {saveStatus[segmentId] === 'error' && <span className="text-ember-red">Save failed</span>}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`ml-auto p-1 rounded-md hover:bg-ink/10 dark:hover:bg-paper/10 transition-opacity ${editingId === segmentId ? 'opacity-100 text-trust-blue' : 'opacity-0 group-hover:opacity-60'}`}
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

// The textarea carries no box of its own: same width, zero padding, no border, so the
// text sits exactly where the read view painted it.
const SEGMENT_EDIT_FIELD =
  'block w-full p-0 resize-none overflow-hidden bg-transparent caret-accent outline-hidden'

export type TranscriptSegmentCardProps = {
  segment: Seg
  isActive: boolean
  matchesForSeg: SegmentMatch[]
  matchIndex: number
  speakerLabel: string
  avatarBg: string
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
}

export default function TranscriptSegmentCard({
  segment: s,
  isActive,
  matchesForSeg,
  matchIndex,
  speakerLabel,
  avatarBg,
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
}: TranscriptSegmentCardProps) {
  const isEditing = editingId === s.id
  // Where keyboard focus returns when Escape closes the editor.
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useLayoutEffect(() => {
    if (!isEditing) return

    const node = textAreaRef.current
    if (!node) return

    autosize(node)
    // The editing identity is the caret and the focus ring, so entering edit
    // mode must hand focus over; caret goes to the end, scroll stays put.
    node.focus({ preventScroll: true })
    node.setSelectionRange(node.value.length, node.value.length)
    // Re-fit on width changes only; reacting to our own height writes would loop.
    let lastWidth = node.clientWidth
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === lastWidth) return
      lastWidth = node.clientWidth
      autosize(node)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [isEditing, s.id])
  const sortedMatches = matchesForSeg.slice().sort((a, b) => a.index - b.index)
  // Tracks the cumulative character offset used with sortedMatches/matchIndex while mapping content and onWordClick spans.
  let charCursor = 0

  return (
    <div
      ref={cardRef}
      data-testid="segment-card"
      data-segment-id={s.id}
      className={`group rounded-xl cursor-pointer flex gap-3 transition-[background-color,box-shadow] ${needHeader ? 'p-3 mt-4' : 'py-2 px-3'} ${isEditing ? `${SEGMENT_EDIT_SURFACE} ${isActive ? SEGMENT_EDIT_FILL_ACTIVE : SEGMENT_EDIT_FILL_RESTING}` : isActive ? 'bg-trust-blue/10 dark:bg-trust-blue/15' : 'hover:bg-subtle'}`}
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
      aria-label={isEditing ? undefined : `Jump playback to ${msToTimestamp(s.start_ms)} for ${speakerLabel}`}
    >
      <div
        className={`shrink-0 self-stretch rounded-full transition-all ${isActive ? 'w-1.5 shadow-xs' : 'w-1 opacity-60'}`}
        style={{ backgroundColor: avatarBg }}
      />

      <div className="flex-1 min-w-0">
        <SegmentHeaderRow
          showSpeaker={needHeader}
          speakerLabel={speakerLabel}
          timestamp={msToTimestamp(s.start_ms)}
          saveStatus={saveStatus}
          segmentId={s.id}
          segmentText={s.text}
          editingId={editingId}
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
            value={editingTexts[s.id] ?? s.text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              const value = e.target.value
              autosize(e.currentTarget)
              setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.id]: value }))
              scheduleSave(s.id, value)
            }}
            onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation()}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              // Escape ends the edit session (edits already saved via scheduleSave)
              // and returns keyboard focus to the card, mirroring the X button.
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditingId(null)
                cardRef.current?.focus()
              }
            }}
            aria-label={`Transcript text for ${speakerLabel} at ${msToTimestamp(s.start_ms)}`}
          />
        ) : (
          <div className={SEGMENT_TEXT_TYPE}>
            {(s.words && s.words.length ? s.words : [{ key: `${s.id}:0`, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text }]).map((w: Word) => {
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
                  pieces.push(<span key={`t-${w.key}-${localPos}`}>{wordText.slice(localPos)}</span>)
                }
                content = <>{pieces}</>
              }
              charCursor = wordEnd
              return (
                <span
                  key={w.key}
                  onClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                    e.stopPropagation()
                    onWordClick(s.id, w.start_ms)
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
