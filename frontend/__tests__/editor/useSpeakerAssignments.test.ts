import { renderHook, act } from '@testing-library/react'
import { useSpeakerAssignments } from '../../app/editor/[id]/hooks/useSpeakerAssignments'
import type { Seg, Speaker } from '../../app/editor/[id]/types'

jest.mock('@/lib/supabase/queries', () => ({
  updateSegment: jest.fn().mockResolvedValue(undefined),
  createSpeaker: jest.fn(),
  updateSpeaker: jest.fn().mockResolvedValue(undefined),
  deleteSpeaker: jest.fn().mockResolvedValue(undefined),
}))

const {
  updateSegment,
  createSpeaker,
  updateSpeaker,
} = jest.requireMock('@/lib/supabase/queries')

const makeAnchorMeasurable = () => ({
  getBoundingClientRect: () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    top: 0,
    right: 100,
    bottom: 30,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect),
})

const makeTriggerElement = () => {
  const button = document.createElement('button')
  jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: 24,
    y: 48,
    width: 88,
    height: 32,
    top: 48,
    right: 112,
    bottom: 80,
    left: 24,
    toJSON: () => ({}),
  } as DOMRect)
  return button
}

function makeSpeaker(overrides: Partial<Speaker> = {}): Speaker {
  return {
    id: 'sp1',
    label: 'Alice',
    transcript_id: 'p1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    color: null,
    ...overrides,
  }
}

function makeSegment(overrides: Partial<Seg> = {}): Seg {
  return {
    id: 's1',
    transcript_id: 'p1',
    speaker_id: 'sp1',
    start_ms: 0,
    end_ms: 5000,
    text: 'Hello',
    is_edited: false,
    is_filler: false,
    algo_version: 'test',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const makeSpeakers = (): Speaker[] => [
  makeSpeaker(),
  makeSpeaker({ id: 'sp2', label: 'Bob', color: '#FF0000' }),
]

function setup(overrides?: Partial<Parameters<typeof useSpeakerAssignments>[0]>) {
  const setSpeakers = jest.fn()
  const setSegments = jest.fn()
  const reloadTranscript = jest.fn().mockResolvedValue(undefined)

  const defaultProps = {
    transcriptId: 'p1',
    speakers: makeSpeakers(),
    setSpeakers,
    setSegments,
    reloadTranscript,
    ...overrides,
  }

  const hookResult = renderHook(() => useSpeakerAssignments(defaultProps))

  return { ...hookResult, setSpeakers, setSegments, reloadTranscript }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useSpeakerAssignments', () => {
  describe('speakersMap', () => {
    it('builds a map from speaker id to speaker', () => {
      const { result } = setup()
      expect(result.current.speakersMap.get('sp1')?.label).toBe('Alice')
      expect(result.current.speakersMap.get('sp2')?.label).toBe('Bob')
    })
  })

  describe('colorForSpeaker', () => {
    it('returns speaker.color if present', () => {
      const { result } = setup()
      const bob = makeSpeakers()[1]
      expect(result.current.colorForSpeaker(bob)).toBe('#FF0000')
    })

    it('returns palette color for speakers without explicit color', () => {
      const { result } = setup()
      const alice = makeSpeakers()[0]
      const color = result.current.colorForSpeaker(alice)
      expect(color).toBe('#4F638C')
    })

    it('returns fallback gray for undefined speaker', () => {
      const { result } = setup()
      expect(result.current.colorForSpeaker(undefined)).toBe('#9CA3AF')
    })
  })

  describe('handleSelectSpeaker', () => {
    it('optimistically updates segments', async () => {
      const { result, setSegments } = setup()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      const newSpeaker = makeSpeakers()[1]
      await act(async () => {
        await result.current.handleSelectSpeaker(newSpeaker)
      })

      expect(setSegments).toHaveBeenCalled()
      expect(updateSegment).toHaveBeenCalledWith('s1', { speaker_id: 'sp2' })
      expect(result.current.speakerPopover).toBeNull()
    })

    it('rolls back on API failure', async () => {
      updateSegment.mockRejectedValueOnce(new Error('fail'))

      const { result, setSegments, reloadTranscript } = setup()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      await act(async () => {
        await result.current.handleSelectSpeaker(makeSpeakers()[1])
      })

      expect(reloadTranscript).toHaveBeenCalledTimes(1)
      expect(setSegments).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleRenameSpeaker', () => {
    it('optimistically renames and calls API', async () => {
      const { result, setSpeakers } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleRenameSpeaker(speaker, 'Charlie')
      })

      expect(setSpeakers).toHaveBeenCalled()
      expect(updateSpeaker).toHaveBeenCalledWith('sp1', { label: 'Charlie' })
    })

    it('reverts name on API failure', async () => {
      updateSpeaker.mockRejectedValueOnce(new Error('fail'))

      const { result, setSpeakers } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleRenameSpeaker(speaker, 'Charlie')
      })

      expect(setSpeakers).toHaveBeenCalledTimes(2)
    })
  })

  describe('handleUntag', () => {
    it('renames speaker to next available Speaker N', async () => {
      const { result, setSpeakers } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleUntag(speaker)
      })

      expect(setSpeakers).toHaveBeenCalled()
      expect(updateSpeaker).toHaveBeenCalledWith('sp1', { label: 'Speaker 0' })
    })
  })

  describe('handleCreateSpeaker', () => {
    it('creates speaker and assigns to segment', async () => {
      const newSpeaker: Speaker = makeSpeaker({ id: 'sp3', label: 'Charlie' })
      createSpeaker.mockResolvedValueOnce(newSpeaker)

      const { result, setSpeakers, setSegments } = setup()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: null,
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      await act(async () => {
        await result.current.handleCreateSpeaker('Charlie')
      })

      expect(createSpeaker).toHaveBeenCalledWith('p1', 'Charlie')
      expect(setSpeakers).toHaveBeenCalled()
      expect(setSegments).toHaveBeenCalled()
      expect(updateSegment).toHaveBeenCalledWith('s1', { speaker_id: 'sp3' })
    })
  })

  describe('anchorRef', () => {
    it('updates the virtual anchor immediately when the avatar is clicked', () => {
      const { result } = setup()
      const triggerElement = makeTriggerElement()

      act(() => {
        result.current.handleAvatarClick(
          {
            stopPropagation: jest.fn(),
            currentTarget: triggerElement,
          } as unknown as React.MouseEvent,
          's1',
          'sp1'
        )
      })

      expect(result.current.anchorRef.current.getBoundingClientRect().width).toBe(88)
      expect(result.current.speakerPopover?.triggerElement).toBe(triggerElement)
      expect(result.current.lastTriggerElementRef.current).toBe(triggerElement)
    })

    it('exposes the current measurable for virtual popover anchoring', () => {
      const { result } = setup()
      const anchorMeasurable = makeAnchorMeasurable()
      const triggerElement = makeTriggerElement()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable,
          triggerElement,
        })
      })

      expect(result.current.anchorRef.current).toBe(anchorMeasurable)
    })

    it('keeps the last measurable after the popover is cleared', async () => {
      const { result } = setup()
      const anchorMeasurable = makeAnchorMeasurable()
      const triggerElement = makeTriggerElement()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable,
          triggerElement,
        })
      })

      await act(async () => {})

      act(() => {
        result.current.setSpeakerPopover(null)
      })

      expect(result.current.anchorRef.current).toBe(anchorMeasurable)
    })
  })
})
