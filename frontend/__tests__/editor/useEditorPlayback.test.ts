import { renderHook, act } from '@testing-library/react'
import { useEditorPlayback } from '../../app/editor/[id]/hooks/useEditorPlayback'

jest.mock('@/app/editor/[id]/hooks/useAudioSessionRecovery', () => ({
  useAudioSessionRecovery: jest.fn(),
}))

function createPlayer(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    togglePlay: jest.fn(),
    seekRelative: jest.fn(),
    setPlaybackRate: jest.fn(),
    seekToMs: jest.fn(),
    seekToFraction: jest.fn(),
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
    transcriptId: 'p1',
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

  it('closes teardown with the retained preview even if the player ref has gone', () => {
    const { result, commitSeek } = setup()
    const player = createPlayer({ isPlaying: jest.fn(() => true) })
    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleExpandedScrubStart()
      result.current.handleMiniScrub(0.75)
      result.current.handleAudioPlayerRef(null)
      result.current.handleExpandedScrubEnd(0.75, 'teardown')
    })
    expect(player.endScrub).toHaveBeenCalledTimes(1)
    expect(player.play).not.toHaveBeenCalled()
    expect(commitSeek).toHaveBeenCalledWith(45000)
    expect(result.current.expandedPlayerScrubbing).toBe(false)
    act(() => result.current.handleExpandedScrubEnd(0.75, 'teardown'))
    expect(commitSeek).toHaveBeenCalledTimes(1)
  })

  it('closes a plain fractional seek immediately without beginning or pausing an audio scrub', () => {
    const { result, startSeek, commitSeek } = setup()
    const player = createPlayer({ isPlaying: jest.fn(() => true) })
    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleMiniSeek(0.5)
    })
    expect(player.seekToFraction).toHaveBeenCalledWith(0.5)
    expect(player.beginScrub).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
    expect(startSeek).toHaveBeenCalledTimes(1)
    expect(commitSeek).toHaveBeenCalledWith(30000, { lockSeek: false })
  })

  it('retains the pointer seek through the press-to-drag threshold without committing or nesting seeking mode', () => {
    const { result, commitSeek, startSeek, previewSeek } = setup()
    let time = 12
    const player = createPlayer({
      getCurrentTime: jest.fn(() => time),
      isPlaying: jest.fn(() => true),
      seekToFraction: jest.fn((fraction: number) => { time = fraction * 60 }),
    })
    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleExpandedSeekStart()
      result.current.handleMiniSeek(0.5)
    })
    expect(result.current.expandedPlayerScrubbing).toBe(true)
    expect(commitSeek).not.toHaveBeenCalled()
    expect(previewSeek).toHaveBeenCalledWith(30000)
    expect(player.pause).not.toHaveBeenCalled()
    act(() => result.current.handleExpandedScrubStart())
    expect(startSeek).toHaveBeenCalledTimes(1)
    expect(player.pause).toHaveBeenCalledTimes(1)
    act(() => {
      result.current.handleExpandedScrubEnd(0.5, 'release')
      result.current.handleMiniSeekEnd(0.5, 'release')
    })
    expect(commitSeek).toHaveBeenCalledTimes(1)
    expect(result.current.expandedPlayerScrubbing).toBe(false)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it('closes a plain pointer press without pausing, flushing a drag, or replaying audio', () => {
    const { result, commitSeek } = setup()
    const player = createPlayer({ isPlaying: jest.fn(() => true) })
    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleExpandedSeekStart()
      result.current.handleMiniSeek(0.5)
      result.current.handleMiniSeekEnd(0.5)
    })
    expect(commitSeek).toHaveBeenCalledWith(12000, { lockSeek: false })
    expect(player.pause).not.toHaveBeenCalled()
    expect(player.endScrub).not.toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
    expect(result.current.expandedPlayerScrubbing).toBe(false)
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

  it('updates editor duration state when the player resolves a late duration hint', () => {
    const { result } = setup()
    const player = createPlayer({
      getCurrentTime: jest.fn(() => 12),
      getDuration: jest.fn(() => 48),
    })

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleAudioDurationChange(48)
    })

    expect(result.current.audioDuration).toBe(48)
    expect(result.current.audioProgress).toBe(25)
  })
})
