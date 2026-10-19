import type { Segment, Speaker as SpeakerType } from '@/contracts/db'
import type { SourceWord } from '@/core/transcript/word-alignment'

export type Seg = Segment
export type Speaker = SpeakerType
export type Match = { segId: string; index: number; length: number }
export type SegmentMatch = { index: number; length: number; matchIdx: number }
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type SaveStatusBySegment = Record<string, SaveStatus>

/** A stored engine word as the editor holds it: its timing, and its id for splitting. */
export type EditorWord = SourceWord & { id: string }
export type WordsBySegment = ReadonlyMap<string, readonly EditorWord[]>
