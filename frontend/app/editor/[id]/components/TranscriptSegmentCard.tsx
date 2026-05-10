import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Word, Seg, SegmentMatch, SaveStatusBySegment } from '../types'
import { msToTimestamp } from '../utils'

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
    'font-sans font-bold text-sm text-ink dark:text-[#EAEAEA] cursor-pointer hover:text-trust-blue transition-all duration-200 ease-out motion-reduce:transition-none bg-transparent border-0 p-0 rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-trust-blue/40 whitespace-nowrap',
    showSpeaker
      ? ''
      : 'max-w-0 -mr-3 overflow-hidden opacity-0 -translate-x-1 pointer-events-none group-hover:max-w-48 group-hover:mr-0 group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto',
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
              aria-hidden={showSpeaker ? undefined : true}
              tabIndex={showSpeaker ? undefined : -1}
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
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent>{editingId === segmentId ? 'Close editor' : 'Edit text'}</TooltipContent>
      </Tooltip>
    </div>
  )
}

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
  textAreaRefs: React.RefObject<Record<string, HTMLTextAreaElement | null>>
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
  textAreaRefs,
  onSegmentClick,
  onWordClick,
  onSpeakerClick,
  setEditingId,
  setEditingTexts,
  scheduleSave,
}: TranscriptSegmentCardProps) {
  const sortedMatches = matchesForSeg.slice().sort((a, b) => a.index - b.index)
  // Tracks the cumulative character offset used with sortedMatches/matchIndex while mapping content and onWordClick spans.
  let charCursor = 0

  return (
    <div
      data-testid="segment-card"
      data-segment-id={s.id}
      className={`group rounded-xl cursor-pointer flex gap-3 transition-colors ${needHeader ? 'p-3 mt-4' : 'py-2 px-3'} ${isActive ? 'bg-trust-blue/10 dark:bg-trust-blue/15' : 'hover:bg-ink/5 dark:hover:bg-white/5'}`}
      onClick={() => onSegmentClick(s.id, s.start_ms)}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSegmentClick(s.id, s.start_ms)
        }
      }}
      role="button"
      tabIndex={editingId === s.id ? -1 : 0}
      aria-label={`Jump playback to ${msToTimestamp(s.start_ms)} for ${speakerLabel}`}
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
        {editingId === s.id ? (
          <div>
            <textarea
              ref={(node: HTMLTextAreaElement | null) => {
                if (node) {
                  textAreaRefs.current[s.id] = node
                } else {
                  delete textAreaRefs.current[s.id]
                }
              }}
              className="w-full border border-ink/10 dark:border-paper/10 bg-surface rounded-md p-2 min-h-[100px] text-current text-base leading-relaxed"
              value={editingTexts[s.id] ?? s.text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                const value = e.target.value
                setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.id]: value }))
                scheduleSave(s.id, value)
              }}
              onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation()}
              aria-label={`Transcript text for ${speakerLabel} at ${msToTimestamp(s.start_ms)}`}
            />
          </div>
        ) : (
          <div className="font-sans text-lg leading-relaxed text-ink/90 dark:text-paper/80">
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
                    <span key={`h-${m.matchIdx}-${idx2}`} className={`${m.matchIdx === matchIndex ? 'bg-warm-highlight text-ink outline-solid outline-2 outline-ember-red dark:bg-trust-blue dark:text-white dark:outline-ember-red' : 'bg-warm-highlight text-ink dark:bg-trust-blue dark:text-white'}`}>{highlight}</span>
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
