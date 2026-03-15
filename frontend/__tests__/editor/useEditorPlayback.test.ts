import { renderHook, act } from '@testing-library/react'
import { useEditorPlayback } from '../../app/editor/[id]/hooks/useEditorPlayback'

jest.mock('@/hooks/useAudioSessionRecovery', () => ({
  useAudioSessionRecovery: jest.fn(),
}))

type ActiveIds = { segId?: string; wordKey?: string }

function createPlayer(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    togglePlay: jest.fn(),
    seekRelative: jest.fn(),
    setPlaybackRate: jest.fn(),
    seekToMs: jest.fn(),
    getCurrentTime: jest.fn(() => 12),
    getDuration: jest.fn(() => 60),
    isPlaying: jest.fn(() => false),
    pause: jest.fn(),
    play: jest.fn(),
    beginScrub: jest.fn(),
    scrubToFraction: jest.fn(),
    endScrub: jest.fn(),
    getAudioElement: jest.fn(() => null),
    ...overrides,
  }
}

function setup(overrides?: Partial<Parameters<typeof useEditorPlayback>[0]>) {
  const setAudioSrc = jest.fn()
  const setStatus = jest.fn()
  const syncActiveSegment = jest.fn(() => undefined)
  const findActiveSegmentId = jest.fn(() => undefined)
  const setActiveIds = jest.fn()
  const ensureActiveSegmentVisible = jest.fn()
  const setWaveformCollapsed = jest.fn()
  const transcriptScrollRef = {
    current: { scrollTop: 80 } as HTMLDivElement | null,
  }
  const isScrubbingRef = { current: false }

  const props = {
    projectId: 'p1',
    audioSrc: 'audio.mp3',
    setAudioSrc,
    setStatus,
    syncActiveSegment,
    findActiveSegmentId,
    activeIds: { segId: 's1' } as ActiveIds,
    setActiveIds,
    isFollowMode: true,
    ensureActiveSegmentVisible,
    isScrubbingRef,
    setWaveformCollapsed,
    transcriptScrollRef,
    setSeekLock: jest.fn(),
    clearSeekLock: jest.fn(),
    ...overrides,
  }

  const hook = renderHook((currentProps) => useEditorPlayback(currentProps), {
    initialProps: props,
  })

  return {
    ...hook,
    props,
    syncActiveSegment,
    ensureActiveSegmentVisible,
    setWaveformCollapsed,
  }
}

describe('useEditorPlayback', () => {
  it('uses the current active segment as a fallback after mini scrub ends', () => {
    const { result, ensureActiveSegmentVisible, syncActiveSegment, setWaveformCollapsed } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleMiniScrubEnd()
    })

    expect(player.endScrub).toHaveBeenCalledTimes(1)
    expect(syncActiveSegment).toHaveBeenCalledWith(12000)
    expect(ensureActiveSegmentVisible).toHaveBeenCalledWith('s1')
    expect(setWaveformCollapsed).toHaveBeenCalledWith(true)
  })

  it('uses the current active segment as a fallback after player drag ends', () => {
    const { result, ensureActiveSegmentVisible, syncActiveSegment, setWaveformCollapsed } = setup({
      activeIds: { segId: 's2' },
    })
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handlePlayerDragEnd()
    })

    expect(syncActiveSegment).toHaveBeenCalledWith(12000)
    expect(ensureActiveSegmentVisible).toHaveBeenCalledWith('s2')
    expect(setWaveformCollapsed).toHaveBeenCalledWith(true)
  })
})
