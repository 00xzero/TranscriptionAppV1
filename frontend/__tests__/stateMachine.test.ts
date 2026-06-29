import {
  validateJobTransition,
  deriveTranscriptStatus,
  isJobStatus,
  isTranscriptStatus,
  isTerminalJobStatus,
} from '@/core/transcription/machine'
import type { JobStatus } from '@/core/transcription/machine'

describe('state-machine', () => {
  describe('validateJobTransition', () => {
    const validTransitions: [JobStatus, JobStatus][] = [
      ['queued', 'processing'],
      ['queued', 'completed'],
      ['queued', 'error'],
      ['processing', 'completed'],
      ['processing', 'error'],
      ['error', 'completed'],
    ]

    test.each(validTransitions)('%s → %s returns applied', (from, to) => {
      expect(validateJobTransition({ from, to })).toEqual({ outcome: 'applied' })
    })

    test('same status returns noop (idempotent)', () => {
      expect(validateJobTransition({ from: 'queued', to: 'queued' })).toEqual({ outcome: 'noop' })
      expect(validateJobTransition({ from: 'completed', to: 'completed' })).toEqual({ outcome: 'noop' })
      expect(validateJobTransition({ from: 'error', to: 'error' })).toEqual({ outcome: 'noop' })
    })

    const invalidTransitions: [JobStatus, JobStatus][] = [
      ['completed', 'processing'],
      ['completed', 'error'],
      ['completed', 'queued'],
      ['error', 'queued'],
      ['error', 'processing'],
      ['processing', 'queued'],
    ]

    test.each(invalidTransitions)('%s → %s returns invalid with reason', (from, to) => {
      const result = validateJobTransition({ from, to, jobId: 'test-job' })
      expect(result.outcome).toBe('invalid')
      expect(result.reason).toContain(from)
      expect(result.reason).toContain(to)
    })
  })

  describe('deriveTranscriptStatus', () => {
    test('no jobs → created', () => {
      expect(deriveTranscriptStatus([])).toBe('created')
    })

    test('any processing → processing', () => {
      expect(deriveTranscriptStatus(['completed', 'processing'])).toBe('processing')
      expect(deriveTranscriptStatus(['processing'])).toBe('processing')
    })

    test('any queued → queued', () => {
      expect(deriveTranscriptStatus(['completed', 'queued'])).toBe('queued')
      expect(deriveTranscriptStatus(['queued'])).toBe('queued')
    })

    test('processing takes precedence over queued', () => {
      expect(deriveTranscriptStatus(['queued', 'processing'])).toBe('processing')
    })

    test('all terminal → newest (last in array)', () => {
      expect(deriveTranscriptStatus(['error', 'completed'])).toBe('completed')
      expect(deriveTranscriptStatus(['completed', 'error'])).toBe('error')
    })

    test('single completed → completed', () => {
      expect(deriveTranscriptStatus(['completed'])).toBe('completed')
    })

    test('single error → error', () => {
      expect(deriveTranscriptStatus(['error'])).toBe('error')
    })
  })

  describe('type guards', () => {
    test('isJobStatus accepts valid statuses', () => {
      expect(isJobStatus('queued')).toBe(true)
      expect(isJobStatus('processing')).toBe(true)
      expect(isJobStatus('completed')).toBe(true)
      expect(isJobStatus('error')).toBe(true)
    })

    test('isJobStatus rejects invalid statuses', () => {
      expect(isJobStatus('failed')).toBe(false)
      expect(isJobStatus('created')).toBe(false)
      expect(isJobStatus('complete')).toBe(false)
      expect(isJobStatus('')).toBe(false)
    })

    test('isTranscriptStatus accepts valid statuses', () => {
      expect(isTranscriptStatus('created')).toBe(true)
      expect(isTranscriptStatus('queued')).toBe(true)
      expect(isTranscriptStatus('processing')).toBe(true)
      expect(isTranscriptStatus('completed')).toBe(true)
      expect(isTranscriptStatus('error')).toBe(true)
    })

    test('isTranscriptStatus rejects invalid statuses', () => {
      expect(isTranscriptStatus('failed')).toBe(false)
      expect(isTranscriptStatus('complete')).toBe(false)
    })

    test('isTerminalJobStatus', () => {
      expect(isTerminalJobStatus('completed')).toBe(true)
      expect(isTerminalJobStatus('error')).toBe(true)
      expect(isTerminalJobStatus('queued')).toBe(false)
      expect(isTerminalJobStatus('processing')).toBe(false)
    })
  })
})
