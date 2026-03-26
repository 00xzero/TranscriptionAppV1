import {
  validateJobTransition,
  deriveProjectStatus,
  isJobStatus,
  isProjectStatus,
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

  describe('deriveProjectStatus', () => {
    test('no jobs → created', () => {
      expect(deriveProjectStatus([])).toBe('created')
    })

    test('any processing → processing', () => {
      expect(deriveProjectStatus(['completed', 'processing'])).toBe('processing')
      expect(deriveProjectStatus(['processing'])).toBe('processing')
    })

    test('any queued → queued', () => {
      expect(deriveProjectStatus(['completed', 'queued'])).toBe('queued')
      expect(deriveProjectStatus(['queued'])).toBe('queued')
    })

    test('processing takes precedence over queued', () => {
      expect(deriveProjectStatus(['queued', 'processing'])).toBe('processing')
    })

    test('all terminal → newest (last in array)', () => {
      expect(deriveProjectStatus(['error', 'completed'])).toBe('completed')
      expect(deriveProjectStatus(['completed', 'error'])).toBe('error')
    })

    test('single completed → completed', () => {
      expect(deriveProjectStatus(['completed'])).toBe('completed')
    })

    test('single error → error', () => {
      expect(deriveProjectStatus(['error'])).toBe('error')
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

    test('isProjectStatus accepts valid statuses', () => {
      expect(isProjectStatus('created')).toBe(true)
      expect(isProjectStatus('queued')).toBe(true)
      expect(isProjectStatus('processing')).toBe(true)
      expect(isProjectStatus('completed')).toBe(true)
      expect(isProjectStatus('error')).toBe(true)
    })

    test('isProjectStatus rejects invalid statuses', () => {
      expect(isProjectStatus('failed')).toBe(false)
      expect(isProjectStatus('complete')).toBe(false)
    })

    test('isTerminalJobStatus', () => {
      expect(isTerminalJobStatus('completed')).toBe(true)
      expect(isTerminalJobStatus('error')).toBe(true)
      expect(isTerminalJobStatus('queued')).toBe(false)
      expect(isTerminalJobStatus('processing')).toBe(false)
    })
  })
})
