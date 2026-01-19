/**
 * Supabase-generated TypeScript types.
 *
 * Generated from Supabase schema on 2026-01-17.
 */

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

// ============================================================================
// Table Row Types (for reading data)
// ============================================================================

export interface Project {
    id: string
    user_id: string
    title: string | null
    status: string
    source_object_key: string | null
    duration_seconds: number | null
    created_at: string
    updated_at: string
}

export interface Job {
    id: string
    project_id: string
    inngest_event_id: string | null
    type: string
    status: string
    payload: Json | null
    created_at: string
    started_at: string | null
    finished_at: string | null
    updated_at: string
}

export interface Speaker {
    id: string
    project_id: string
    label: string
    color: string | null
    created_at: string
    updated_at: string
}

export interface Segment {
    id: string
    project_id: string
    speaker_id: string | null
    start_ms: number
    end_ms: number
    text: string
    created_at: string
    updated_at: string
}

export interface Word {
    id: string
    segment_id: string
    text: string
    start_ms: number
    end_ms: number
    confidence: number | null
    speaker_label: string | null
    created_at: string
}

export interface Chunk {
    id: string
    project_id: string
    speaker_id: string | null
    start_ms: number
    end_ms: number
    text: string
    source_segment_ids: string[] | null
    is_edited: boolean
    is_filler: boolean
    algo_version: string
    created_at: string
    updated_at: string
}

export interface ChunkWord {
    id: string
    chunk_id: string
    word_id: string
    order_index: number
    created_at: string
}

export interface WatchlistTerm {
    id: string
    project_id: string
    term: string
    canonical: string
    created_at: string
    updated_at: string
}

// ============================================================================
// Insert Types (for creating records)
// ============================================================================

export interface ProjectInsert {
    id?: string
    user_id: string
    title?: string | null
    status?: string
    source_object_key?: string | null
    duration_seconds?: number | null
    created_at?: string
    updated_at?: string
}

export interface SpeakerInsert {
    id?: string
    project_id: string
    label?: string
    color?: string | null
}

export interface ChunkUpdate {
    text?: string
    speaker_id?: string | null
    is_edited?: boolean
}

export interface SpeakerUpdate {
    label?: string
    color?: string | null
}

export interface ProjectUpdate {
    title?: string | null
    status?: string
    duration_seconds?: number | null
}

// ============================================================================
// Derived Word type for Editor (with calculated timings)
// ============================================================================

export interface EditorWord {
    key: string
    start_ms: number
    end_ms: number
    text: string
}

export interface EditorChunk extends Chunk {
    words?: EditorWord[]
}
