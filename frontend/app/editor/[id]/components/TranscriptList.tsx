import React from 'react'
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import TranscriptSegmentCard from './TranscriptSegmentCard'
import type { SpeakerDisplay } from '@/lib/speakers/display'
import type { PlaybackClock } from '../playbackClock'
import type { BusyKind } from '../hooks/useSegmentSplit'
import type { Seg, SegmentMatch, SaveStatusBySegment, WordsBySegment } from '../types'

export type TranscriptListProps = {
  segments: Seg[]
  wordsBySegment: WordsBySegment
  /** Segments whose split or undo is waiting on the database. */
  busy: ReadonlyMap<string, BusyKind>
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
  onRetryUnconfirmed: (segId: string) => void
  caretHint: (segId: string) => number | undefined
}

export default function TranscriptList({
  segments,
  wordsBySegment,
  busy,
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
  onRetryUnconfirmed,
  caretHint,
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
                onRetryUnconfirmed={onRetryUnconfirmed}
                caretHint={caretHint}
              />
            </div>
          )
        }}
      />
    </div>
  )
}
