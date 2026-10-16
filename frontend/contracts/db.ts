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
  // The Deepgram response file in the transcription-results bucket.
  result_object_key: z.string().nullable(),
  error_message: z.string().nullable(),
  error_type: z.string().nullable(),
  error_detail: z.string().nullable(),
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

// A person as the People directory lists them (people_directory). An
// appearance is a transcript where one of their linked speakers has segments;
// last_seen_at is the created_at of the newest such transcript.
// Source of truth: infra/supabase/migrations/20260926000000_people_directory.sql
export const DirectoryPersonSchema = PersonSchema.extend({
  organisation_name: z.string().nullable(),
  transcript_count: z.number().int().nonnegative(),
  last_seen_at: z.string().nullable(),
})

export const DirectoryOrganisationSchema = OrganisationSchema.extend({
  person_count: z.number().int().nonnegative(),
})

// Speaking time is the summed length of segments: the person's in talk_ms,
// everyone's in transcript_talk_ms, so the page can show their share.
export const PersonAppearanceSchema = z.object({
  transcript_id: UuidSchema,
  title: z.string().nullable(),
  project_id: UuidSchema.nullable(),
  created_at: z.string(),
  talk_ms: z.number().int().nonnegative(),
  transcript_talk_ms: z.number().int().nonnegative(),
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
  /** Counts shape changes (split, rejoin); every write names the revision it was made against. */
  revision: z.number().int().nonnegative(),
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
// guarded speaker functions below, and its shape through the split functions.
export const SegmentUpdateSchema = z.object({
  text: z.string().optional(),
  is_edited: z.boolean().optional(),
})

// === RPC: segment split ===
// Each call names the revision it was made against; the database refuses a
// mismatch (SP002). A replay of a completed call returns its result. See:
//   infra/supabase/migrations/20261013000000_segment_split.sql

// split_segment returns the segment and its new second half, in display order.
export const SplitSegmentResultSchema = z.array(SegmentSchema).length(2)

// One edit of a set_segment_texts_guarded call: the text to write, and the
// revision and text it replaces. See:
//   infra/supabase/migrations/20261013120000_editor_history_guards.sql
export const SegmentTextEditSchema = z.object({
  segment_id: UuidSchema,
  expected_revision: z.number().int().nonnegative(),
  expected_text: z.string(),
  text: z.string(),
})
export type SegmentTextEdit = z.infer<typeof SegmentTextEditSchema>

// === RPC: guarded speaker writes ===
// Each call carries the values it expects to replace; the database refuses a
// write whose expectation no longer holds (SQLSTATE SP002). See:
//   infra/supabase/migrations/20260924000000_speaker_identity_foundations.sql

// One segment of a reassign_segments call. speaker_id null means Unknown.
// expected_revision is the segment's shape the change was chosen against: a
// split or rejoin since refuses it, like a changed speaker. See
//   infra/supabase/migrations/20261013000000_segment_split.sql
export const SegmentSpeakerChangeSchema = z.object({
  segment_id: UuidSchema,
  expected_speaker_id: UuidSchema.nullable(),
  expected_revision: z.number().int().nonnegative(),
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

// === RPC: the People directory ===
// See infra/supabase/migrations/20260926000000_people_directory.sql

export const PeopleDirectorySchema = z.object({
  people: z.array(DirectoryPersonSchema),
  organisations: z.array(DirectoryOrganisationSchema),
})

export const PersonAppearancesSchema = z.array(PersonAppearanceSchema)

export const PersonOrganisationResultSchema = z.object({
  person: PersonSchema,
  organisation: OrganisationSchema.nullable(),
})

// The changes Remove from this transcript made; swapping each expectation and
// target undoes them through reassign_segments.
export const RemovePersonResultSchema = z.array(SegmentSpeakerChangeSchema)

// One local voice a merge would move: a linked transcript speaker with
// segments, and their summed length in talk_ms. It has its own label only if
// it was given one; detected_ordinals holds the ordinals of the detected
// speakers its segments came from (null for Unknown), which is how a voice
// without a label is described.
export const MergePreviewVoiceSchema = z.object({
  speaker_id: UuidSchema,
  custom_label: z.string().nullable(),
  talk_ms: z.number().int().nonnegative(),
  detected_ordinals: z.array(z.number().int().nonnegative().nullable()),
}).strict()

export const MergePreviewPersonSchema = z.object({
  person_id: UuidSchema,
  name: z.string(),
  preferred_color: z.string(),
  organisation_id: UuidSchema.nullable(),
  organisation_name: z.string().nullable(),
}).strict()

// This snapshot is sent back for an exact database comparison. Reject new
// fields at every level instead of silently stripping them from the preview.
export const MergePreviewSchema = z.object({
  survivor: MergePreviewPersonSchema,
  // Transcripts the survivor already appears in, where the two will show as one.
  survivor_transcript_ids: z.array(UuidSchema),
  // In the order the people were given.
  people: z.array(MergePreviewPersonSchema.extend({
    transcripts: z.array(z.object({
      transcript_id: UuidSchema,
      title: z.string().nullable(),
      created_at: z.string(),
      voices: z.array(MergePreviewVoiceSchema),
    }).strict()),
  }).strict()),
}).strict()

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
// view-model consumed straight by SpeakerAvatarGroup with no mapping layer.
// See infra/supabase/migrations/20260926000000_people_directory.sql

// A linked person, once per project scope however many transcripts carry them.
export const ProjectPersonPreviewSchema = z.object({
  kind: z.literal('person'),
  id: UuidSchema,
  name: z.string(),
  color: z.string(),
  organisationName: z.string().nullable(),
})

// One of a transcript's identities with segments, as the label resolver needs it.
export const ProjectVoicePeerSchema = z.object({
  id: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  customLabel: z.string().nullable(),
  personId: UuidSchema.nullable(),
  personName: z.string().nullable(),
  organisationName: z.string().nullable(),
})

// An unlinked transcript speaker. `peers` lists its transcript's speakers with
// segments in order of first appearance, itself included, so the client can
// label it exactly as the editor does (`Paul (2)`).
export const ProjectVoicePreviewSchema = z.object({
  kind: z.literal('voice'),
  id: UuidSchema,
  transcriptId: UuidSchema,
  transcriptTitle: z.string().nullable(),
  peers: z.array(ProjectVoicePeerSchema),
})

export const ProjectSpeakerPreviewSchema = z.discriminatedUnion('kind', [
  ProjectPersonPreviewSchema,
  ProjectVoicePreviewSchema,
])

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
export type ProjectVoicePreview = z.infer<typeof ProjectVoicePreviewSchema>
export type DirectoryPerson = z.infer<typeof DirectoryPersonSchema>
export type DirectoryOrganisation = z.infer<typeof DirectoryOrganisationSchema>
export type PeopleDirectory = z.infer<typeof PeopleDirectorySchema>
export type PersonAppearance = z.infer<typeof PersonAppearanceSchema>
export type PersonOrganisationResult = z.infer<typeof PersonOrganisationResultSchema>
export type MergePreview = z.infer<typeof MergePreviewSchema>
export type MergePreviewVoice = z.infer<typeof MergePreviewVoiceSchema>
export type ProjectSpeakerSummary = z.infer<typeof ProjectSpeakerSummarySchema>

// Json — recursive union, no Zod schema needed (no validation boundary)
export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]
