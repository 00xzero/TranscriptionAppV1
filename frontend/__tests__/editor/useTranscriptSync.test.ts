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

      expect(result.current.findActiveSegmentId(5150)).toBe('s1')
      expect(result.current.findActiveSegmentId(5151)).toBe('s2')
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

      act(() => {
        result.current.onAudioTick(2500)
      })
      expect(result.current.activeIds.segId).toBe('s1')

      act(() => {
        result.current.onSegmentSeek('s1')
      })

      act(() => {
        result.current.onAudioTick(7500)
      })

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

      rerender({ segments, editingId: 's1', speakerPopover: null })
      expect(result.current.isFollowMode).toBe(false)

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

  describe('waveform height measurement', () => {
    it('does not replace expanded height with collapsed transition measurements', () => {
      const { result } = setup()
      const waveform = document.createElement('div')
      let measuredHeight = 320

      jest.spyOn(waveform, 'getBoundingClientRect').mockImplementation(() => ({
        left: 0,
        right: 0,
        top: 0,
        bottom: measuredHeight,
        width: 0,
        height: measuredHeight,
        x: 0,
        y: 0,
        toJSON: () => {},
      }))
      Object.defineProperty(waveform, 'offsetHeight', {
        configurable: true,
        get: () => measuredHeight,
      })

      act(() => {
        result.current.expandedWaveformContainerRef(waveform)
      })

      expect(result.current.expandedWaveformHeight).toBe(320)

      act(() => {
        result.current.setWaveformCollapsed(true)
      })

      measuredHeight = 24

      act(() => {
        result.current.expandedWaveformContainerRef(waveform)
      })

      expect(result.current.expandedWaveformHeight).toBe(320)
    })
  })
})
