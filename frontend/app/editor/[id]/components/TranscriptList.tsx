import React from 'react'
import { Virtuoso, VirtuosoHandle, ListRange } from 'react-virtuoso'
import TranscriptSegmentCard from './TranscriptSegmentCard'
import type { Seg, SegmentMatch, SaveStatusBySegment, Speaker } from '../types'

export type TranscriptListProps = {
  segments: Seg[]
  scrollParent: HTMLElement | null
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onRangeChanged: (range: ListRange) => void
  activeSegId: string | undefined
  matchesBySeg: Map<string, SegmentMatch[]>
  matchIndex: number
  speakersMap: Map<string, Speaker>
  colorForSpeaker: (sp: Speaker | undefined) => string
  editingId: string | null
  editingTexts: Record<string, string>
  saveStatus: SaveStatusBySegment
  textAreaRefs: React.RefObject<Record<string, HTMLTextAreaElement | null>>
  onSegmentClick: (segId: string, ms: number) => void
  onWordClick: (segId: string, ms: number) => void
  onSpeakerClick: (e: React.MouseEvent, chunkId: string, speakerId: string | null) => void
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
  speakersMap,
  colorForSpeaker,
  editingId,
  editingTexts,
  saveStatus,
  textAreaRefs,
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
          const prevSpeakerId = idx > 0 ? (segments[idx - 1]?.speaker_id ?? null) : null
          const needHeader = idx === 0 || (s.speaker_id ?? null) !== prevSpeakerId
          const sp = s.speaker_id ? speakersMap.get(s.speaker_id) : undefined
          const matchesForSeg: SegmentMatch[] = matchesBySeg.get(s.id) ?? []
          return (
            <TranscriptSegmentCard
              segment={s}
              isActive={activeSegId === s.id}
              matchesForSeg={matchesForSeg}
              matchIndex={matchIndex}
              speakerLabel={sp?.label || 'Unknown'}
              avatarBg={colorForSpeaker(sp)}
              needHeader={needHeader}
              editingId={editingId}
              editingTexts={editingTexts}
              saveStatus={saveStatus}
              textAreaRefs={textAreaRefs}
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
