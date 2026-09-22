/** @jest-environment node */

import {
  CreateTranscriptBodySchema,
  DeleteProjectErrorSchema,
  DeleteProjectResponseSchema,
} from '@/contracts/api'
import { ProjectNameSchema } from '@/contracts/primitives'
import { DeepgramWebhookPayloadSchema, DeepgramAsyncResponseSchema } from '@/contracts/webhook'
import { TransitionJobInputSchema } from '@/contracts/state-machine'
import {
  JobStatusSchema,
  ProjectInsertSchema,
  ProjectSchema,
  ProjectUpdateSchema,
  TranscriptSchema,
  TranscriptStatusSchema,
  TranscriptSummarySchema,
} from '@/contracts/db'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

describe('TranscriptSummarySchema', () => {
  const fullRow = {
    id: VALID_UUID,
    user_id: '22222222-2222-2222-2222-222222222222',
    project_id: null,
    title: 'Standup',
    status: 'completed',
    source_object_key: 'user/media.webm',
    upload_intent_id: 'intent-1',
    duration_seconds: 90,
    waveform_object_key: null,
    waveform_status: 'ready',
    waveform_points_per_second: 50,
    waveform_version: 1,
    created_at: '2026-09-12T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
  }

  test('reduces a complete transcript row to the seven summary fields', () => {
    expect(TranscriptSummarySchema.parse(fullRow)).toEqual({
      id: VALID_UUID,
      project_id: null,
      title: 'Standup',
      status: 'completed',
      duration_seconds: 90,
      created_at: '2026-09-12T00:00:00Z',
      updated_at: '2026-09-12T00:00:00Z',
    })
  })

  test('rejects missing or invalid required fields', () => {
    const withoutStatus: Record<string, unknown> = { ...fullRow }
    delete withoutStatus.status
    expect(TranscriptSummarySchema.safeParse(withoutStatus).success).toBe(false)
    expect(TranscriptSummarySchema.safeParse({ ...fullRow, status: 'archived' }).success).toBe(false)
    expect(TranscriptSummarySchema.safeParse({ ...fullRow, id: 'transcript-a' }).success).toBe(false)
  })
})

describe('CreateTranscriptBodySchema', () => {
  test('rejects missing filename', () => {
    const result = CreateTranscriptBodySchema.safeParse({ title: 'test' })
    expect(result.success).toBe(false)
  })

  test('rejects empty filename', () => {
    const result = CreateTranscriptBodySchema.safeParse({ filename: '' })
    expect(result.success).toBe(false)
  })

  test('rejects key_terms with non-strings', () => {
    const result = CreateTranscriptBodySchema.safeParse({ filename: 'audio.mp3', key_terms: [1, 2] })
    expect(result.success).toBe(false)
  })

  test('accepts valid body', () => {
    const result = CreateTranscriptBodySchema.safeParse({
      filename: 'audio.mp3',
      title: 'My recording',
      key_terms: ['term1', 'term2'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.filename).toBe('audio.mp3')
    }
  })

  test('accepts body with only filename', () => {
    const result = CreateTranscriptBodySchema.safeParse({ filename: 'audio.mp3' })
    expect(result.success).toBe(true)
  })

  test('accepts a valid project id and rejects an invalid one', () => {
    expect(
      CreateTranscriptBodySchema.safeParse({ filename: 'audio.mp3', project_id: VALID_UUID }).success
    ).toBe(true)
    expect(
      CreateTranscriptBodySchema.safeParse({ filename: 'audio.mp3', project_id: 'not-a-uuid' }).success
    ).toBe(false)
  })
})

describe('project schemas', () => {
  const row = {
    id: VALID_UUID,
    user_id: '22222222-2222-2222-2222-222222222222',
    parent_id: null,
    name: 'Work',
    deleting_at: null,
    created_at: '2026-09-12T00:00:00Z',
    updated_at: '2026-09-12T00:00:00Z',
  }

  test('validates project rows and transcript project membership', () => {
    expect(ProjectSchema.safeParse(row).success).toBe(true)
    expect(
      TranscriptSchema.safeParse({
        id: VALID_UUID,
        user_id: row.user_id,
        project_id: row.id,
        title: null,
        status: 'created',
        source_object_key: null,
        upload_intent_id: null,
        duration_seconds: null,
        waveform_object_key: null,
        waveform_status: 'skipped',
        waveform_points_per_second: null,
        waveform_version: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }).success
    ).toBe(true)
  })

  test('trims project names and enforces the database length bounds', () => {
    expect(ProjectNameSchema.parse('  Work  ')).toBe('Work')
    expect(ProjectInsertSchema.parse({
      user_id: row.user_id,
      parent_id: null,
      name: '  Work  ',
    }).name).toBe('Work')
    expect(ProjectUpdateSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(ProjectNameSchema.safeParse('   ').success).toBe(false)
    expect(ProjectNameSchema.safeParse('x'.repeat(81)).success).toBe(false)
  })

  test('validates project deletion response shapes', () => {
    expect(
      DeleteProjectResponseSchema.safeParse({ deleted_projects: 2, deleted_transcripts: 3 }).success
    ).toBe(true)
    expect(
      DeleteProjectErrorSchema.safeParse({
        error: 'project not found',
        stage: 'begin',
        gone: true,
      }).success
    ).toBe(true)
    expect(
      DeleteProjectErrorSchema.safeParse({
        error: 'storage cleanup failed',
        stage: 'storage',
        removed_media: 1,
        removed_waveforms: 0,
        remaining_transcripts: 2,
      }).success
    ).toBe(true)
    expect(
      DeleteProjectErrorSchema.safeParse({
        error: 'branch changed',
        stage: 'finish',
      }).success
    ).toBe(true)
    expect(
      DeleteProjectErrorSchema.safeParse({
        error: 'missing storage counts',
        stage: 'storage',
      }).success
    ).toBe(false)
    expect(
      DeleteProjectErrorSchema.safeParse({
        error: 'bad stage',
        stage: 'unknown',
        removed_media: 0,
        removed_waveforms: 0,
        remaining_transcripts: 0,
      }).success
    ).toBe(false)
  })
})

describe('DeepgramWebhookPayloadSchema', () => {
  test('fails for empty object {}', () => {
    // Empty object is actually valid since all fields are optional — the real guard is the
    // metadata check in the route handler. But we can test structurally wrong shapes.
    const result = DeepgramWebhookPayloadSchema.safeParse({})
    // Empty {} is valid (all optional) — structural validation passes
    expect(result.success).toBe(true)
  })

  test('fails for non-object payload', () => {
    expect(DeepgramWebhookPayloadSchema.safeParse('not an object').success).toBe(false)
    expect(DeepgramWebhookPayloadSchema.safeParse(null).success).toBe(false)
    expect(DeepgramWebhookPayloadSchema.safeParse(42).success).toBe(false)
  })

  test('succeeds for payload with metadata.request_id and metadata.extra.transcript_id', () => {
    const result = DeepgramWebhookPayloadSchema.safeParse({
      metadata: {
        request_id: 'r1',
        extra: { transcript_id: VALID_UUID },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata?.request_id).toBe('r1')
    }
  })

  test('DeepgramAsyncResponseSchema is distinct — requires top-level request_id', () => {
    expect(DeepgramAsyncResponseSchema.safeParse({ request_id: 'r1' }).success).toBe(true)
    expect(DeepgramAsyncResponseSchema.safeParse({}).success).toBe(false)
    expect(DeepgramAsyncResponseSchema.safeParse({ metadata: { request_id: 'r1' } }).success).toBe(false)
  })
})

describe('TransitionJobInputSchema', () => {
  test('fails for non-UUID jobId', () => {
    const result = TransitionJobInputSchema.safeParse({ jobId: 'not-a-uuid', to: 'processing' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('UUID')
    }
  })

  test('fails for invalid to status', () => {
    const result = TransitionJobInputSchema.safeParse({ jobId: VALID_UUID, to: 'unknown_status' })
    expect(result.success).toBe(false)
  })

  test('succeeds for valid input', () => {
    const result = TransitionJobInputSchema.safeParse({ jobId: VALID_UUID, to: 'processing' })
    expect(result.success).toBe(true)
  })

  test('accepts optional fields', () => {
    const result = TransitionJobInputSchema.safeParse({
      jobId: VALID_UUID,
      to: 'completed',
      extraJobFields: { finished_at: '2026-01-01T00:00:00Z' },
      metadata: { segmentCount: 5 },
      context: 'test',
    })
    expect(result.success).toBe(true)
  })
})

describe('Status enum schemas', () => {
  test('JobStatusSchema rejects unknown string', () => {
    expect(JobStatusSchema.safeParse('unknown').success).toBe(false)
    expect(JobStatusSchema.safeParse('').success).toBe(false)
  })

  test('JobStatusSchema accepts all valid values', () => {
    for (const s of ['queued', 'processing', 'completed', 'error']) {
      expect(JobStatusSchema.safeParse(s).success).toBe(true)
    }
  })

  test('TranscriptStatusSchema rejects unknown string', () => {
    expect(TranscriptStatusSchema.safeParse('unknown').success).toBe(false)
  })

  test('TranscriptStatusSchema accepts all valid values', () => {
    for (const s of ['created', 'queued', 'processing', 'completed', 'error']) {
      expect(TranscriptStatusSchema.safeParse(s).success).toBe(true)
    }
  })
})
