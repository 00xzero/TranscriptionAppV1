import { renderHook, act } from '@testing-library/react'
import { useTranscriptSync } from '@/app/editor/[id]/hooks/useTranscriptSync'
import type { Seg } from '@/app/editor/[id]/types'

jest.mock('react-virtuoso')

function makeSegment(overrides: Partial<Seg> = {}): Seg {
  return {
    id: 's1',
    project_id: 'p1',
    speaker_id: 'sp1',
    start_ms: 0,
    end_ms: 5000,
    text: 'First segment',
    source_segment_ids: null,
    is_edited: false,
    is_filler: false,
    algo_version: 'test',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const segments: Seg[] = [
  makeSegment(),
  makeSegment({ id: 's2', start_ms: 5000, end_ms: 10000, text: 'Second segment' }),
  makeSegment({ id: 's3', speaker_id: 'sp2', start_ms: 10000, end_ms: 15000, text: 'Third segment' }),
]

function setup(overrides?: Partial<Parameters<typeof useTranscriptSync>[0]>) {
  const defaultProps = {
    segments,
    editingId: null,
    speakerPopover: null,
    ...overrides,
  }

  return renderHook(
    ({ segments, editingId, speakerPopover }) =>
      useTranscriptSync({ segments, editingId, speakerPopover }),
    { initialProps: defaultProps },
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
})

describe('useTranscriptSync', () => {
  describe('findActiveSegmentId', () => {
    it('returns correct segment for a given time', () => {
      const { result } = setup()

      expect(result.current.findActiveSegmentId(2500)).toBe('s1')
      expect(result.current.findActiveSegmentId(7500)).toBe('s2')
      expect(result.current.findActiveSegmentId(12500)).toBe('s3')
    })

    it('applies SYNC_OFFSET_MS', () => {
      const { result } = setup()

      // SYNC_OFFSET_MS is 150ms. The hook subtracts it: tAdj = tMs - 150.
      // At 5150ms: adjusted = 5150 - 150 = 5000. s1.end_ms is 5000 and the
      // check is tAdj <= seg.end_ms, so s1 still matches (boundary inclusive).
      expect(result.current.findActiveSegmentId(5150)).toBe('s1')

      // At 5151ms: adjusted = 5151 - 150 = 5001, which exceeds s1.end_ms.
      // s2.start_ms is 5000 and 5001 <= s2.end_ms (10000), so s2 matches.
      expect(result.current.findActiveSegmentId(5151)).toBe('s2')

      // At 4999ms: adjusted = 4999 - 150 = 4849, which is within s1 (0..5000)
      expect(result.current.findActiveSegmentId(4999)).toBe('s1')
    })
  })

  describe('onAudioTick', () => {
    it('sets activeIds', () => {
      const { result } = setup()

      act(() => {
        result.current.onAudioTick(2500)
      })

      expect(result.current.activeIds.segId).toBe('s1')
    })

    it('skips update during seek lock', () => {
      const { result } = setup()

      // Set an initial active segment so we can verify it doesn't change
      act(() => {
        result.current.onAudioTick(2500)
      })
      expect(result.current.activeIds.segId).toBe('s1')

      act(() => {
        result.current.onSegmentSeek('s1', 2500)
      })

      // Attempt to sync to a different segment while locked
      act(() => {
        result.current.onAudioTick(7500)
      })

      // activeIds should still point at s1 because the lock blocked the update
      expect(result.current.activeIds.segId).toBe('s1')
    })
  })

  describe('onWordSeek', () => {
    it('updates the active segment immediately and keeps it during seek lock', () => {
      const { result } = setup()

      act(() => {
        result.current.onAudioTick(2500)
      })
      expect(result.current.activeIds.segId).toBe('s1')

      act(() => {
        result.current.onWordSeek('s3')
      })

      expect(result.current.activeIds.segId).toBe('s3')

      act(() => {
        result.current.onAudioTick(7500)
      })

      expect(result.current.activeIds.segId).toBe('s3')
    })
  })

  describe('isFollowMode', () => {
    it('defaults to true', () => {
      const { result } = setup()
      expect(result.current.isFollowMode).toBe(true)
    })
  })

  describe('editing disables follow mode', () => {
    it('sets isFollowMode to false when editingId is provided', () => {
      const { result, rerender } = setup()

      expect(result.current.isFollowMode).toBe(true)

      rerender({ segments, editingId: 's1', speakerPopover: null })

      expect(result.current.isFollowMode).toBe(false)
    })
  })

  describe('resumeFollow', () => {
    it('re-enables follow mode', () => {
      const { result, rerender } = setup()

      // Disable follow mode by providing an editingId
      rerender({ segments, editingId: 's1', speakerPopover: null })
      expect(result.current.isFollowMode).toBe(false)

      // Clear the editing state so the effect doesn't immediately re-disable
      rerender({ segments, editingId: null, speakerPopover: null })

      act(() => {
        result.current.resumeFollow()
      })

      expect(result.current.isFollowMode).toBe(true)
    })
  })

  describe('blocking state', () => {
    it('does not auto-resume follow mode when editing ends', () => {
      const { result, rerender } = setup()

      rerender({ segments, editingId: 's1', speakerPopover: null })
      expect(result.current.isFollowMode).toBe(false)

      rerender({ segments, editingId: null, speakerPopover: null })

      expect(result.current.isFollowMode).toBe(false)
    })
  })
})
