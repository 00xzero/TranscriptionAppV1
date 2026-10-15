import React from 'react'
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import TranscriptSegmentCard from './TranscriptSegmentCard'
import type { SpeakerDisplay } from '@/lib/speakers/display'
import type { TextInput } from '@/core/editor/typing-steps'
import type { PlaybackClock } from '../playbackClock'
import type { BusyKind } from '../hooks/useSegmentHolds'
import type { CaretHint } from '../hooks/useTranscriptMutations'
import type { Seg, SegmentMatch, SaveStatusBySegment, WordsBySegment } from '../types'

export type TranscriptListProps = {
  segments: Seg[]
  wordsBySegment: WordsBySegment
  /** Segments a waiting write is about to change the text or shape of. */
  busy: ReadonlyMap<string, BusyKind>
  /** Whether a segment can't be split or have its speaker changed: a waiting write is about to change it, or the editor is reconnecting. */
  isLocked: (segmentId: string) => boolean
  playbackClock: PlaybackClock
  scrollParent: HTMLElement | null
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onRangeChanged: (range: ListRange) => void
  /** The current segment: highlighted as a card, and the one whose words follow playback. */
  activeSegId: string | undefined
  matchesBySeg: Map<string, SegmentMatch[]>
  matchIndex: number
  displayForSpeaker: (speakerId: string | null) => SpeakerDisplay
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
  caretHint: (segId: string) => CaretHint | undefined
  /** Segments briefly lit after an undo or redo changed them. */
  flashing: ReadonlySet<string>
  onTextInput: (segId: string, input: TextInput) => void
  sealTyping: (segId: string) => void
  endDrag?: () => void
  onHistory: (dir: 'undo' | 'redo') => void
}

export default function TranscriptList({
  segments,
  wordsBySegment,
  busy,
  isLocked,
  playbackClock,
  scrollParent,
  virtuosoRef,
  onRangeChanged,
  activeSegId,
  matchesBySeg,
  matchIndex,
  displayForSpeaker,
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
  endDrag,
  onHistory,
}: TranscriptListProps) {
  if (!scrollParent) return null
  return (
    <div className="px-6 md:px-20 max-w-5xl mx-auto">
      <Virtuoso
        ref={virtuosoRef}
        customScrollParent={scrollParent}
        data={segments}
        // Keyed by segment, so a split or undo inserting or removing a row
        // never hands one card's state (its textarea, caret) to another.
        computeItemKey={(_idx: number, s: Seg) => s.id}
        overscan={1200}
        rangeChanged={onRangeChanged}
        itemContent={(idx: number, s: Seg) => {
          const speaker = displayForSpeaker(s.speaker_id ?? null)
          // A new turn starts when the displayed identity changes (spec §3).
          const needHeader = idx === 0 ||
            speaker.identityKey !== displayForSpeaker(segments[idx - 1]?.speaker_id ?? null).identityKey
          const matchesForSeg: SegmentMatch[] = matchesBySeg.get(s.id) ?? []
          // Contain the card's top margin so Virtuoso measures the turn spacing
          // when replacing off-screen rows with padding.
          return (
            <div className="flow-root">
              <TranscriptSegmentCard
                segment={s}
                sourceWords={wordsBySegment.get(s.id)}
                busy={busy.get(s.id)}
                locked={isLocked(s.id)}
                isActive={activeSegId === s.id}
                playbackClock={playbackClock}
                matchesForSeg={matchesForSeg}
                matchIndex={matchIndex}
                speaker={speaker}
                needHeader={needHeader}
                editingId={editingId}
                editingTexts={editingTexts}
                saveStatus={saveStatus}
                onSegmentClick={onSegmentClick}
                onWordClick={onWordClick}
                onSpeakerClick={onSpeakerClick}
                setEditingId={setEditingId}
                setEditingTexts={setEditingTexts}
                scheduleSave={scheduleSave}
                onSplit={onSplit}
                caretHint={caretHint}
                flashing={flashing.has(s.id)}
                onTextInput={onTextInput}
                sealTyping={sealTyping}
                endDrag={endDrag}
                onHistory={onHistory}
              />
            </div>
          )
        }}
      />
    </div>
  )
}
