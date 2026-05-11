import { renderHook, act } from '@testing-library/react'
import { useEditorPlayback } from '../../app/editor/[id]/hooks/useEditorPlayback'

jest.mock('@/hooks/useAudioSessionRecovery', () => ({
  useAudioSessionRecovery: jest.fn(),
}))

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
  const onAudioTick = jest.fn(() => undefined)
  const startSeek = jest.fn()
  const previewSeek = jest.fn(() => undefined)
  const commitSeek = jest.fn(() => undefined)
  const onWordSeek = jest.fn()
  const onSegmentSeek = jest.fn()
  const setWaveformCollapsed = jest.fn()
  const shouldCollapseWaveform = jest.fn(() => true)

  const props = {
    projectId: 'p1',
    audioSrc: 'audio.mp3',
    setAudioSrc,
    setStatus,
    onAudioTick,
    startSeek,
    previewSeek,
    commitSeek,
    onWordSeek,
    onSegmentSeek,
    setWaveformCollapsed,
    shouldCollapseWaveform,
    ...overrides,
  }

  const hook = renderHook((currentProps) => useEditorPlayback(currentProps), {
    initialProps: props,
  })

  return {
    ...hook,
    props,
    onAudioTick,
    startSeek,
    previewSeek,
    commitSeek,
    onWordSeek,
    onSegmentSeek,
    setWaveformCollapsed,
    shouldCollapseWaveform,
  }
}

describe('useEditorPlayback', () => {
  it('commits the current player position after mini scrub ends', () => {
    const { result, commitSeek, setWaveformCollapsed, shouldCollapseWaveform } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleMiniScrubStart()
      result.current.handleMiniScrubEnd()
    })

    expect(player.endScrub).toHaveBeenCalledTimes(1)
    expect(shouldCollapseWaveform).toHaveBeenCalledTimes(1)
    expect(commitSeek).toHaveBeenCalledWith(12000)
    expect(setWaveformCollapsed).toHaveBeenCalledWith(true)
  })

  it('commits the current player position after player drag ends', () => {
    const { result, commitSeek, setWaveformCollapsed, shouldCollapseWaveform, startSeek } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handlePlayerDragStart()
    })

    expect(result.current.expandedPlayerScrubbing).toBe(true)

    act(() => {
      result.current.handlePlayerDragEnd()
    })

    expect(startSeek).toHaveBeenCalledTimes(1)
    expect(shouldCollapseWaveform).toHaveBeenCalledTimes(1)
    expect(commitSeek).toHaveBeenCalledWith(12000)
    expect(setWaveformCollapsed).toHaveBeenCalledWith(true)
    expect(result.current.expandedPlayerScrubbing).toBe(false)
  })

  it('keeps the expanded player pinned while the expanded waveform is being scrubbed', () => {
    const { result } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleExpandedScrubStart()
    })

    expect(result.current.expandedPlayerScrubbing).toBe(true)
    expect(player.beginScrub).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.handleExpandedScrubEnd()
    })

    expect(result.current.expandedPlayerScrubbing).toBe(false)
  })

  it('does not pin the expanded player for mini-player scrubs', () => {
    const { result } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleMiniScrubStart()
    })

    expect(result.current.expandedPlayerScrubbing).toBe(false)
  })

  it('ignores mini scrub gestures before the player is ready', () => {
    const { result, startSeek, commitSeek } = setup()

    act(() => {
      result.current.handleMiniScrubStart()
      result.current.handleMiniScrubEnd()
    })

    expect(startSeek).not.toHaveBeenCalled()
    expect(commitSeek).not.toHaveBeenCalled()
  })

  it('updates the active segment before seeking when a word is clicked', () => {
    const { result, onWordSeek } = setup()
    const player = createPlayer()

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleAudioReady()
      result.current.onWordClick('s2', 7500)
    })

    expect(onWordSeek).toHaveBeenCalledWith('s2')
    expect(player.seekToMs).toHaveBeenCalledWith(7500)
  })
})
