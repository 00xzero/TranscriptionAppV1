import type { Segment, Speaker as SpeakerType } from '@/contracts/db'

export type Seg = Segment
export type Speaker = SpeakerType
export type Match = { segId: string; index: number; length: number }
export type SegmentMatch = { index: number; length: number; matchIdx: number }
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type SaveStatusBySegment = Record<string, SaveStatus>
