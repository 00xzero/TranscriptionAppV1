/**
 * Zod schemas for all DB row types.
 * Source of truth: infra/supabase/migrations/
 */

import { z } from 'zod'
import { TEXT_LIMITS } from './limits'
import { ProjectNameSchema, UuidSchema } from './primitives'

// Status enums — canonical, imported by state-machine.ts and transition.ts
export const JobStatusSchema = z.enum(['queued', 'processing', 'completed', 'error'])
export const TranscriptStatusSchema = z.enum(['created', 'queued', 'processing', 'completed', 'error'])
export const WaveformStatusSchema = z.enum(['pending', 'processing', 'ready', 'error', 'skipped'])

// === Load-bearing schemas (used at validation boundaries) ===
// Source of truth: infra/supabase/migrations/20260114000000_initial_schema.sql

export const TranscriptSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  project_id: UuidSchema.nullable(),
  title: z.string().nullable(),
  status: TranscriptStatusSchema,
  source_object_key: z.string().nullable(),
  upload_intent_id: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  waveform_object_key: z.string().nullable(),
  waveform_status: WaveformStatusSchema,
  waveform_points_per_second: z.number().nullable(),
  waveform_version: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

/** The app-wide transcript index keeps only the fields list surfaces read. */
export const TranscriptSummarySchema = TranscriptSchema.pick({
  id: true,
  project_id: true,
  title: true,
  status: true,
  duration_seconds: true,
  created_at: true,
  updated_at: true,
})

export const ProjectSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  parent_id: UuidSchema.nullable(),
  // Plain string on read: TEXT_LIMITS apply to writes only (see contracts/limits.ts).
  name: z.string(),
  deleting_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const JobSchema = z.object({
  id: UuidSchema,
  transcript_id: UuidSchema,
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

// A transcript speaker: one local voice in one transcript. It displays its
// custom_label, or `Speaker {ordinal}` without one; core/speakers/labels.ts is
// the only place that turns these fields into a label.
// Source of truth: infra/supabase/migrations/20260924000000_speaker_identity_foundations.sql
export const SpeakerSchema = z.object({
  id: UuidSchema,
  transcript_id: UuidSchema,
  user_id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  custom_label: z.string().nullable(),
  diarization_index: z.number().int().nonnegative().nullable(),
  person_id: UuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const OrganisationSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const PersonSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  name: z.string(),
  organisation_id: UuidSchema.nullable(),
  preferred_color: z.string(),
  hidden: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

// A person as the editor's picker sees them (editor_people_context). The
// figures describe appearances in OTHER transcripts: the editor works out who
// is in the open transcript from its own speaker state.
export const EditorPersonSchema = PersonSchema.extend({
  organisation_name: z.string().nullable(),
  other_transcript_count: z.number().int().nonnegative(),
  last_other_title: z.string().nullable(),
  last_other_seen_at: z.string().nullable(),
  // Appears in another transcript of the open transcript's project.
  in_project: z.boolean(),
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
  transcript_id: UuidSchema,
  speaker_id: UuidSchema.nullable(),
  /** Deepgram's speaker number, fixed at save; Remove returns the segment to its detected speaker. */
  diarization_index: z.number().int().nonnegative().nullable(),
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  text: z.string(),
  is_edited: z.boolean(),
  is_filler: z.boolean(),
  algo_version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const WatchlistTermSchema = z.object({
  id: UuidSchema,
  transcript_id: UuidSchema,
  term: z.string(),
  canonical: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

// Insert/update schemas (DB mutations)
export const TranscriptUpdateSchema = z.object({
  title: z.string().max(TEXT_LIMITS.transcriptTitle).nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
})

export const ProjectInsertSchema = z.object({
  id: UuidSchema.optional(),
  user_id: UuidSchema,
  parent_id: UuidSchema.nullable(),
  name: ProjectNameSchema,
})

export const ProjectUpdateSchema = z.object({
  name: ProjectNameSchema,
})

// Server-only update schema for waveform fields. Must NOT be used by browser-facing
// code paths — these fields are populated by the Inngest worker via the admin client.
// Excluding them from TranscriptUpdateSchema prevents a client from forging waveform_status
// or pointing waveform_object_key at an arbitrary blob.
export const TranscriptWaveformInternalUpdateSchema = z.object({
  waveform_object_key: z.string().nullable().optional(),
  waveform_status: WaveformStatusSchema.optional(),
  waveform_points_per_second: z.number().nullable().optional(),
  waveform_version: z.number().int().nullable().optional(),
})

// Only text is directly writable; a segment's speaker changes through the
// guarded speaker functions below.
export const SegmentUpdateSchema = z.object({
  text: z.string().optional(),
  is_edited: z.boolean().optional(),
})

// === RPC: guarded speaker writes ===
// Each call carries the values it expects to replace; the database refuses a
// write whose expectation no longer holds (SQLSTATE SP002). See:
//   infra/supabase/migrations/20260924000000_speaker_identity_foundations.sql

// One segment of a reassign_segments call. speaker_id null means Unknown.
export const SegmentSpeakerChangeSchema = z.object({
  segment_id: UuidSchema,
  expected_speaker_id: UuidSchema.nullable(),
  speaker_id: UuidSchema.nullable(),
})

// One segment of a correct_segments_to_person call. The database chooses or
// creates the target speaker, so a change names only the expected one.
export const NewSpeakerSegmentChangeSchema = SegmentSpeakerChangeSchema.omit({ speaker_id: true })

export const SegmentSpeakerAssignmentSchema = z.object({
  segment_id: UuidSchema,
  speaker_id: UuidSchema.nullable(),
})

// RETURNS TABLE, so PostgREST hands back an array of rows.
export const ReassignSegmentsResultSchema = z.array(SegmentSpeakerAssignmentSchema)

// === RPC: people in the editor ===
// See infra/supabase/migrations/20260924120000_people_editor.sql

export const EditorPeopleContextSchema = z.object({
  people: z.array(EditorPersonSchema),
})

export const PersonCorrectionResultSchema = z.object({
  speaker: SpeakerSchema,
  person: PersonSchema,
  assignments: z.array(SegmentSpeakerAssignmentSchema),
})

export const LocalSpeakerResultSchema = PersonCorrectionResultSchema.omit({ person: true })

// === RPC: save_transcript_segments ===
// The webhook handler builds the full transcript in TypeScript (segment-builder) and
// hands it to a single Postgres function that atomically replaces all segments + words
// + speaker upserts for the transcript. See:
//   infra/supabase/migrations/*_save_transcript_segments_rpc.sql

const SaveTranscriptSegmentsWordSchema = z.object({
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  confidence: z.number(),
  order_index: z.number().int().nonnegative(),
  speaker: z.number().int().nullable(),
  speaker_confidence: z.number().nullable(),
  punctuated_text: z.string(),
  paragraph_index: z.number().int().nullable(),
  sentence_end: z.boolean(),
})

const SaveTranscriptSegmentsSegmentSchema = z.object({
  id: UuidSchema,
  speaker_num: z.number().int().nullable(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  is_filler: z.boolean(),
  algo_version: z.string(),
  words: z.array(SaveTranscriptSegmentsWordSchema),
})

// num is Deepgram's speaker number; the RPC keys transcript speakers on it.
const SaveTranscriptSegmentsSpeakerSchema = z.object({
  num: z.number().int().nonnegative(),
})

export const SaveTranscriptSegmentsPayloadSchema = z.object({
  speakers: z.array(SaveTranscriptSegmentsSpeakerSchema),
  segments: z.array(SaveTranscriptSegmentsSegmentSchema),
})

export const SaveTranscriptSegmentsResultSchema = z.object({
  segment_count: z.number().int().nonnegative(),
  word_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
})

// project_speaker_summaries RPC. Row columns stay snake_case like every other
// row shape here; the preview entries are camelCase because they are a synthetic
// view-model — paletteIndex has no table counterpart — consumed straight by
// SpeakerAvatarGroup with no mapping layer.
export const ProjectSpeakerPreviewSchema = z.object({
  id: UuidSchema,
  transcriptId: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  customLabel: z.string().nullable(),
  paletteIndex: z.number().int().nonnegative(),
})

export const ProjectSpeakerSummarySchema = z.object({
  project_id: UuidSchema,
  speaker_count: z.number().int().nonnegative(),
  preview: z.array(ProjectSpeakerPreviewSchema),
})

// RETURNS TABLE means PostgREST hands back an array of rows even for one id.
export const ProjectSpeakerSummariesResultSchema = z.array(ProjectSpeakerSummarySchema)

// Type exports
export type JobStatus = z.infer<typeof JobStatusSchema>
export type TranscriptStatus = z.infer<typeof TranscriptStatusSchema>
export type WaveformStatus = z.infer<typeof WaveformStatusSchema>
export type Transcript = z.infer<typeof TranscriptSchema>
export type TranscriptSummary = z.infer<typeof TranscriptSummarySchema>
export type Project = z.infer<typeof ProjectSchema>
export type Job = z.infer<typeof JobSchema>
export type JobSummary = Omit<Job, 'payload'>
export type Speaker = z.infer<typeof SpeakerSchema>
export type Person = z.infer<typeof PersonSchema>
export type Organisation = z.infer<typeof OrganisationSchema>
export type EditorPerson = z.infer<typeof EditorPersonSchema>
export type EditorPeopleContext = z.infer<typeof EditorPeopleContextSchema>
export type PersonCorrectionResult = z.infer<typeof PersonCorrectionResultSchema>
export type LocalSpeakerResult = z.infer<typeof LocalSpeakerResultSchema>
export type Word = z.infer<typeof WordSchema>
export type Segment = z.infer<typeof SegmentSchema>
export type WatchlistTerm = z.infer<typeof WatchlistTermSchema>
export type TranscriptUpdate = z.infer<typeof TranscriptUpdateSchema>
export type ProjectInsert = z.infer<typeof ProjectInsertSchema>
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>
export type TranscriptWaveformInternalUpdate = z.infer<typeof TranscriptWaveformInternalUpdateSchema>
export type SegmentUpdate = z.infer<typeof SegmentUpdateSchema>
export type SegmentSpeakerChange = z.infer<typeof SegmentSpeakerChangeSchema>
export type NewSpeakerSegmentChange = z.infer<typeof NewSpeakerSegmentChangeSchema>
export type SegmentSpeakerAssignment = z.infer<typeof SegmentSpeakerAssignmentSchema>
export type SaveTranscriptSegmentsPayload = z.infer<typeof SaveTranscriptSegmentsPayloadSchema>
export type SaveTranscriptSegmentsResult = z.infer<typeof SaveTranscriptSegmentsResultSchema>
export type ProjectSpeakerPreview = z.infer<typeof ProjectSpeakerPreviewSchema>
export type ProjectSpeakerSummary = z.infer<typeof ProjectSpeakerSummarySchema>

// Json — recursive union, no Zod schema needed (no validation boundary)
export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]
