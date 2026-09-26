import React from 'react'
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import TranscriptSegmentCard from './TranscriptSegmentCard'
import type { SpeakerDisplay } from '@/lib/speakers/display'
import type { Seg, SegmentMatch, SaveStatusBySegment } from '../types'

export type TranscriptListProps = {
  segments: Seg[]
  scrollParent: HTMLElement | null
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onRangeChanged: (range: ListRange) => void
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
}

export default function TranscriptList({
  segments,
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
}: TranscriptListProps) {
  if (!scrollParent) return null
  return (
    <div className="px-6 md:px-20 max-w-5xl mx-auto">
      <Virtuoso
        ref={virtuosoRef}
        customScrollParent={scrollParent}
        data={segments}
        overscan={1200}
        rangeChanged={onRangeChanged}
        itemContent={(idx: number, s: Seg) => {
          const speaker = displayForSpeaker(s.speaker_id ?? null)
          // A new turn starts when the displayed identity changes (spec §3).
          const needHeader = idx === 0 ||
            speaker.identityKey !== displayForSpeaker(segments[idx - 1]?.speaker_id ?? null).identityKey
          const matchesForSeg: SegmentMatch[] = matchesBySeg.get(s.id) ?? []
          return (
            <TranscriptSegmentCard
              segment={s}
              isActive={activeSegId === s.id}
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
            />
          )
        }}
      />
    </div>
  )
}
