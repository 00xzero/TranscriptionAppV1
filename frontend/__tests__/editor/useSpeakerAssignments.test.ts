import { renderHook, act } from '@testing-library/react'
import { useSpeakerAssignments } from '../../app/editor/[id]/hooks/useSpeakerAssignments'
import type { Seg, Speaker } from '../../app/editor/[id]/types'

jest.mock('@/lib/supabase/queries', () => ({
  reassignSegments: jest.fn().mockResolvedValue([]),
  assignSegmentsToNewSpeaker: jest.fn(),
  setSpeakerCustomLabel: jest.fn(),
}))

const {
  reassignSegments,
  assignSegmentsToNewSpeaker,
  setSpeakerCustomLabel,
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
    transcript_id: 'p1',
    user_id: 'u1',
    ordinal: 0,
    custom_label: 'Alice',
    diarization_index: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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
  makeSpeaker({ id: 'sp2', ordinal: 1, custom_label: null, diarization_index: 1 }),
]

function setup(overrides?: Partial<Parameters<typeof useSpeakerAssignments>[0]>) {
  const setSpeakers = jest.fn()
  const setSegments = jest.fn()
  const reloadSpeakerAssignments = jest.fn().mockResolvedValue(true)

  const defaultProps = {
    transcriptId: 'p1',
    speakers: makeSpeakers(),
    segments: [makeSegment()],
    setSpeakers,
    setSegments,
    reloadSpeakerAssignments,
    ...overrides,
  }

  const hookResult = renderHook(() => useSpeakerAssignments(defaultProps))

  return { ...hookResult, setSpeakers, setSegments, reloadSpeakerAssignments }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useSpeakerAssignments', () => {
  describe('speakersMap', () => {
    it('builds a map from speaker id to speaker', () => {
      const { result } = setup()
      expect(result.current.speakersMap.get('sp1')?.custom_label).toBe('Alice')
      expect(result.current.speakersMap.get('sp2')?.ordinal).toBe(1)
    })
  })

  describe('labelForSpeaker', () => {
    it('resolves custom and generic labels, and Unknown for no speaker', () => {
      const { result } = setup()
      expect(result.current.labelForSpeaker('sp1')).toBe('Alice')
      expect(result.current.labelForSpeaker('sp2')).toBe('Speaker 1')
      expect(result.current.labelForSpeaker(null)).toBe('Unknown speaker')
    })

    it('numbers a second speaker with the same label by first appearance', () => {
      const { result } = setup({
        speakers: [makeSpeaker(), makeSpeaker({ id: 'sp2', ordinal: 1, custom_label: 'Alice' })],
        segments: [
          makeSegment({ id: 's1', speaker_id: 'sp2' }),
          makeSegment({ id: 's2', speaker_id: 'sp1', start_ms: 5000 }),
        ],
      })
      expect(result.current.labelForSpeaker('sp2')).toBe('Alice')
      expect(result.current.labelForSpeaker('sp1')).toBe('Alice (2)')
    })
  })

  describe('colorForSpeaker', () => {
    it('returns the palette color for the speaker position', () => {
      const { result } = setup()
      const [alice, second] = makeSpeakers()
      expect(result.current.colorForSpeaker(alice)).toBe('#4F638C')
      expect(result.current.colorForSpeaker(second)).toBe('#C73E1D')
    })

    it('returns fallback gray for undefined speaker', () => {
      const { result } = setup()
      expect(result.current.colorForSpeaker(undefined)).toBe('#9CA3AF')
    })
  })

  describe('handleSelectSpeaker', () => {
    it('optimistically updates segments and sends a guarded reassignment', async () => {
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
      expect(reassignSegments).toHaveBeenCalledWith('p1', [
        { segment_id: 's1', expected_speaker_id: 'sp1', speaker_id: 'sp2' },
      ])
      expect(result.current.speakerPopover).toBeNull()
    })

    it('expects null for an unassigned segment', async () => {
      const { result } = setup({ segments: [makeSegment({ speaker_id: null })] })

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: null,
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      await act(async () => {
        await result.current.handleSelectSpeaker(makeSpeakers()[0])
      })

      expect(reassignSegments).toHaveBeenCalledWith('p1', [
        { segment_id: 's1', expected_speaker_id: null, speaker_id: 'sp1' },
      ])
    })

    it('rolls back on API failure', async () => {
      reassignSegments.mockRejectedValueOnce(new Error('fail'))

      const { result, setSegments, reloadSpeakerAssignments } = setup()

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

      expect(reloadSpeakerAssignments).toHaveBeenCalledTimes(1)
      expect(setSegments).toHaveBeenCalledTimes(1)
    })
  })

  describe('when the refresh after a failed write also fails', () => {
    it('undoes an unsaved segment reassignment locally', async () => {
      reassignSegments.mockRejectedValueOnce(new Error('offline'))
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
      const reloadSpeakerAssignments = jest.fn().mockResolvedValue(false)
      const { result, setSegments } = setup({ reloadSpeakerAssignments })

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

      expect(setSegments).toHaveBeenCalledTimes(2)
      const undo = setSegments.mock.calls[1][0] as (prev: Seg[]) => Seg[]
      expect(undo([makeSegment({ speaker_id: 'sp2' })])[0].speaker_id).toBe('sp1')
      consoleError.mockRestore()
    })

    it('restores the previous label when the current one cannot be read', async () => {
      setSpeakerCustomLabel.mockRejectedValueOnce(new Error('offline'))
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
      const reloadSpeakerAssignments = jest.fn().mockResolvedValue(false)
      const { result, setSpeakers } = setup({ reloadSpeakerAssignments })

      await act(async () => {
        await result.current.handleRenameSpeaker(makeSpeakers()[0], 'Charlie')
      })

      expect(setSpeakers).toHaveBeenCalledTimes(2)
      const undo = setSpeakers.mock.calls[1][0] as (prev: Speaker[]) => Speaker[]
      expect(undo([makeSpeaker({ custom_label: 'Charlie' })])[0].custom_label).toBe('Alice')
      consoleError.mockRestore()
    })
  })

  describe('handleRenameSpeaker', () => {
    it('optimistically renames and sends the label it expects to replace', async () => {
      setSpeakerCustomLabel.mockResolvedValueOnce(makeSpeaker({ custom_label: 'Charlie' }))
      const { result, setSpeakers } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleRenameSpeaker(speaker, 'Charlie')
      })

      expect(setSpeakers).toHaveBeenCalledTimes(2)
      expect(setSpeakerCustomLabel).toHaveBeenCalledWith('sp1', 'Alice', 'Charlie')
    })

    it('refreshes from the database when the rename is refused, rather than restoring the old label', async () => {
      // Another tab renamed the speaker first; the old local label is stale too.
      setSpeakerCustomLabel.mockRejectedValueOnce({ code: 'SP002', message: 'speaker label changed since it was read' })
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

      const { result, setSpeakers, reloadSpeakerAssignments } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleRenameSpeaker(speaker, 'Charlie')
      })

      expect(reloadSpeakerAssignments).toHaveBeenCalledTimes(1)
      // Only the optimistic update; no rollback to 'Alice'.
      expect(setSpeakers).toHaveBeenCalledTimes(1)
      consoleError.mockRestore()
    })
  })

  describe('handleUntag', () => {
    it('clears the custom label so the speaker shows Speaker {ordinal} again', async () => {
      setSpeakerCustomLabel.mockResolvedValueOnce(makeSpeaker({ custom_label: null }))
      const { result, setSpeakers } = setup()

      const speaker = makeSpeakers()[0]
      await act(async () => {
        await result.current.handleUntag(speaker)
      })

      expect(setSpeakerCustomLabel).toHaveBeenCalledWith('sp1', 'Alice', null)
      const optimistic = setSpeakers.mock.calls[0][0] as (prev: Speaker[]) => Speaker[]
      expect(optimistic([speaker])[0].custom_label).toBeNull()
    })
  })

  describe('handleCreateSpeaker', () => {
    it('creates the speaker and moves the segment in one guarded call', async () => {
      const newSpeaker: Speaker = makeSpeaker({ id: 'sp3', ordinal: 2, custom_label: 'Charlie', diarization_index: null })
      assignSegmentsToNewSpeaker.mockResolvedValueOnce(newSpeaker)

      const { result, setSpeakers, setSegments } = setup()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      await act(async () => {
        await result.current.handleCreateSpeaker('Charlie')
      })

      expect(assignSegmentsToNewSpeaker).toHaveBeenCalledWith('p1', 'Charlie', [
        { segment_id: 's1', expected_speaker_id: 'sp1' },
      ])
      expect(setSpeakers).toHaveBeenCalled()
      expect(setSegments).toHaveBeenCalled()
    })

    it('refreshes assignments instead of guessing when the call fails', async () => {
      assignSegmentsToNewSpeaker.mockRejectedValueOnce(new Error('fail'))
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

      const { result, setSpeakers, setSegments, reloadSpeakerAssignments } = setup()

      act(() => {
        result.current.setSpeakerPopover({
          segmentId: 's1',
          speakerId: 'sp1',
          anchorMeasurable: makeAnchorMeasurable(),
          triggerElement: makeTriggerElement(),
        })
      })

      await act(async () => {
        await result.current.handleCreateSpeaker('Charlie')
      })

      expect(setSpeakers).not.toHaveBeenCalled()
      expect(setSegments).not.toHaveBeenCalled()
      expect(reloadSpeakerAssignments).toHaveBeenCalledTimes(1)
      consoleError.mockRestore()
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
