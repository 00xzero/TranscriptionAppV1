/**
 * Zod schemas for all DB row types.
 * Source of truth: infra/supabase/migrations/
 */

import { z } from 'zod'
import { UuidSchema } from './primitives'

// Status enums — canonical, imported by state-machine.ts and transition.ts
export const JobStatusSchema = z.enum(['queued', 'processing', 'completed', 'error'])
export const ProjectStatusSchema = z.enum(['created', 'queued', 'processing', 'completed', 'error'])

// === Load-bearing schemas (used at validation boundaries) ===
// Source of truth: infra/supabase/migrations/20260114000000_initial_schema.sql

export const ProjectSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  title: z.string().nullable(),
  status: ProjectStatusSchema,
  source_object_key: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const JobSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  inngest_event_id: z.string().nullable(),
  idempotency_key: z.string().nullable(),
  type: z.string(),
  status: JobStatusSchema,
  payload: z.unknown().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  updated_at: z.string(),
})

export const SpeakerSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  label: z.string(),
  color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ChunkSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  speaker_id: UuidSchema.nullable(),
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  text: z.string(),
  source_segment_ids: z.array(UuidSchema).nullable(),
  is_edited: z.boolean(),
  is_filler: z.boolean(),
  algo_version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

// === Secondary schemas (type derivation only — not used for runtime validation) ===
// Note: migration has order_index + updated_at; no speaker_label (stale types.ts had it wrong)
export const WordSchema = z.object({
  id: UuidSchema,
  segment_id: UuidSchema,
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  text: z.string(),
  confidence: z.number().nullable(),
  order_index: z.number().int(),
  speaker: z.number().int().nullable().optional(),
  speaker_confidence: z.number().nullable().optional(),
  punctuated_text: z.string().nullable().optional(),
  paragraph_index: z.number().int().nullable().optional(),
  sentence_end: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const SegmentSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  speaker_id: UuidSchema.nullable(),
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  text: z.string(),
  is_edited: z.boolean(),
  is_filler: z.boolean(),
  algo_version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ChunkWordSchema = z.object({
  id: UuidSchema,
  chunk_id: UuidSchema,
  word_id: UuidSchema,
  order_index: z.number().int(),
  created_at: z.string(),
})

export const WatchlistTermSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  term: z.string(),
  canonical: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

// Insert/update schemas (DB mutations)
export const ProjectInsertSchema = z.object({
  id: UuidSchema.optional(),
  user_id: UuidSchema,
  title: z.string().nullish(),
  source_object_key: z.string().nullish(),
  duration_seconds: z.number().nullish(),
})

export const ProjectUpdateSchema = z.object({
  title: z.string().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
})

export const SpeakerInsertSchema = z.object({
  id: UuidSchema.optional(),
  project_id: UuidSchema,
  label: z.string().optional(),
  color: z.string().nullish(),
})

export const ChunkUpdateSchema = z.object({
  text: z.string().optional(),
  speaker_id: UuidSchema.nullable().optional(),
  is_edited: z.boolean().optional(),
})

export const SegmentUpdateSchema = z.object({
  text: z.string().optional(),
  speaker_id: UuidSchema.nullable().optional(),
  is_edited: z.boolean().optional(),
})

export const SpeakerUpdateSchema = z.object({
  label: z.string().optional(),
  color: z.string().nullable().optional(),
})

// Type exports
export type JobStatus = z.infer<typeof JobStatusSchema>
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Job = z.infer<typeof JobSchema>
export type JobSummary = Omit<Job, 'payload'>
export type Speaker = z.infer<typeof SpeakerSchema>
export type Chunk = z.infer<typeof ChunkSchema>
export type Word = z.infer<typeof WordSchema>
export type Segment = z.infer<typeof SegmentSchema>
export type ChunkWord = z.infer<typeof ChunkWordSchema>
export type WatchlistTerm = z.infer<typeof WatchlistTermSchema>
export type ProjectInsert = z.infer<typeof ProjectInsertSchema>
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>
export type SpeakerInsert = z.infer<typeof SpeakerInsertSchema>
export type ChunkUpdate = z.infer<typeof ChunkUpdateSchema>
export type SegmentUpdate = z.infer<typeof SegmentUpdateSchema>
export type SpeakerUpdate = z.infer<typeof SpeakerUpdateSchema>

// Json — recursive union, no Zod schema needed (no validation boundary)
export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]
