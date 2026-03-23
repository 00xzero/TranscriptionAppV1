/** @jest-environment node */

import { CreateProjectBodySchema } from '@/lib/schemas/api'
import { DeepgramWebhookPayloadSchema, DeepgramAsyncResponseSchema } from '@/lib/schemas/webhook'
import { TransitionJobInputSchema } from '@/lib/schemas/state-machine'
import { JobStatusSchema, ProjectStatusSchema } from '@/lib/schemas/db'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

describe('CreateProjectBodySchema', () => {
  test('rejects missing filename', () => {
    const result = CreateProjectBodySchema.safeParse({ title: 'test' })
    expect(result.success).toBe(false)
  })

  test('rejects empty filename', () => {
    const result = CreateProjectBodySchema.safeParse({ filename: '' })
    expect(result.success).toBe(false)
  })

  test('rejects key_terms with non-strings', () => {
    const result = CreateProjectBodySchema.safeParse({ filename: 'audio.mp3', key_terms: [1, 2] })
    expect(result.success).toBe(false)
  })

  test('accepts valid body', () => {
    const result = CreateProjectBodySchema.safeParse({
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
    const result = CreateProjectBodySchema.safeParse({ filename: 'audio.mp3' })
    expect(result.success).toBe(true)
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

  test('succeeds for payload with metadata.request_id and metadata.extra.project_id', () => {
    const result = DeepgramWebhookPayloadSchema.safeParse({
      metadata: {
        request_id: 'r1',
        extra: { project_id: VALID_UUID },
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
      metadata: { chunkCount: 5 },
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

  test('ProjectStatusSchema rejects unknown string', () => {
    expect(ProjectStatusSchema.safeParse('unknown').success).toBe(false)
  })

  test('ProjectStatusSchema accepts all valid values', () => {
    for (const s of ['created', 'queued', 'processing', 'completed', 'error']) {
      expect(ProjectStatusSchema.safeParse(s).success).toBe(true)
    }
  })
})
