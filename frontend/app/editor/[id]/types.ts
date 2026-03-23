import type { Chunk, Segment, Speaker as SpeakerType, EditorWord } from '@/lib/supabase/types'

export type Word = EditorWord
export type Seg = (Chunk | Segment) & { words?: Word[] }
export type Speaker = SpeakerType
export type Match = { segId: string; index: number; length: number }
export type SegmentMatch = { index: number; length: number; matchIdx: number }
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type SaveStatusBySegment = Record<string, SaveStatus>
