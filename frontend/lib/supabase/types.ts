/**
 * Supabase TypeScript types — thin re-export barrel.
 * All types are derived from Zod schemas in lib/schemas/.
 */

// Json stays here as a plain TypeScript type — it's a recursive union that needs z.lazy() in Zod,
// has no validation boundary, and no benefit from schema derivation.
export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type {
    Project,
    Job,
    JobSummary,
    Speaker,
    Segment,
    Word,
    Chunk,
    ChunkWord,
    WatchlistTerm,
    ProjectInsert,
    SpeakerInsert,
    ProjectUpdate,
    ChunkUpdate,
    SpeakerUpdate,
} from '@/lib/schemas/db'

export type { EditorWord, EditorChunk } from '@/lib/schemas/editor'
