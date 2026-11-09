import { renderHook, act } from '@testing-library/react'
import { useEditorPlayback } from '../../app/(app)/editor/[id]/hooks/useEditorPlayback'

import { toast } from '@/components/ui/toaster'

jest.mock('@/components/ui/toaster', () => ({ toast: jest.fn() }))

function createPlayer(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    togglePlay: jest.fn(),
    seekRelative: jest.fn(),
    setPlaybackRate: jest.fn(),
    seekToMs: jest.fn(),
    seekToFraction: jest.fn(),
    getCurrentTime: jest.fn(() => 12),
    getDuration: jest.fn(() => 60),
    isReady: jest.fn(() => true),
    isPlaying: jest.fn(() => false),
    pause: jest.fn(),
    play: jest.fn(),
    reload: jest.fn(),
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

  it('moves the playback clock on seeks and, once moved, on time updates', () => {
    const { result } = setup()
    let seconds = 12
    const player = createPlayer({ getCurrentTime: jest.fn(() => seconds) })

    act(() => {
      result.current.handleAudioPlayerRef(player as any)
      result.current.handleAudioReady()
      // A time update before anything has played or seeked shows nothing.
      result.current.handleTimeUpdate(seconds)
    })
    expect(result.current.playbackClock.getMs()).toBeNull()

    act(() => result.current.handleSeeked())
    expect(result.current.playbackClock.getMs()).toBe(12000)

    seconds = 13.5
    act(() => result.current.handleTimeUpdate(seconds))
    expect(result.current.playbackClock.getMs()).toBe(13500)
  })
})


describe('playback during audio recovery', () => {
  const mediaError = { code: 4 } as MediaError
  const originalFetch = global.fetch
  beforeEach(() => { jest.useFakeTimers(); jest.mocked(toast).mockClear() })
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); global.fetch = originalFetch })

  function playingSource() {
    const hook = setup()
    const audio = Object.assign(new EventTarget(), { currentTime: 42, paused: false, error: null as MediaError | null, play: jest.fn(async () => {}) })
    const player = createPlayer({
      getAudioElement: jest.fn(() => audio), getCurrentTime: jest.fn(() => audio.currentTime),
      togglePlay: jest.fn(() => { if (audio.paused) void audio.play() }),
      seekToMs: jest.fn((ms: number) => { audio.currentTime = ms / 1000 }),
    })
    act(() => {
      hook.result.current.handleAudioPlayerRef(player as any)
      hook.result.current.handlePlayingChange(true)
    })
    expect(hook.result.current.playbackClock.getMs()).toBe(42000)
    return { ...hook, audio, player }
  }

  it.each(['request', 'body'] as const)('times out a hung %s and ignores its late result after Retry', async (phase) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    let resolveResponse!: (response: Response) => void
    let resolveBody!: (body: { url: string }) => void
    const lateUrl = { url: 'late.mp3' }
    const fetch = jest.fn<ReturnType<typeof global.fetch>, Parameters<typeof global.fetch>>()
      .mockImplementationOnce(() => phase === 'request'
        ? new Promise((resolve) => { resolveResponse = resolve })
        : Promise.resolve({ ok: true, json: () => new Promise((resolve) => { resolveBody = resolve }) } as Response))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'retry.mp3' }) } as Response)
    global.fetch = fetch
    const { result, audio, props } = playingSource()
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })

    await act(async () => { jest.advanceTimersByTime(14_999) })
    expect(toast).not.toHaveBeenCalled()
    await act(async () => { jest.advanceTimersByTime(1) })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(result.current.playing).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)

    await act(async () => { jest.mocked(toast).mock.calls[0][0].action?.onClick() })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(props.setAudioSrc).toHaveBeenCalledWith('retry.mp3')

    await act(async () => {
      if (phase === 'request') resolveResponse({ ok: true, json: async () => lateUrl } as Response)
      else resolveBody(lateUrl)
    })
    expect(props.setAudioSrc).toHaveBeenCalledTimes(1)
  })

  it.each([50, 58])('restores the latest seek to %is after a failed-source refresh', async (seconds) => {
    let resolveFetch!: (response: Response) => void
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const { result, audio } = playingSource()
    act(() => result.current.handleAudioReady())
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => result.current.onWordClick('s2', 50_000))
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response)
    })
    act(() => {
      audio.error = null
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      if (seconds === 58) result.current.onSegmentClick('s3', 58_000)
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(audio.currentTime).toBe(seconds)
    expect(result.current.playbackClock.getMs()).toBe(seconds * 1000)
  })

  it.each(['±5 s', 'scrubber', 'keyboard'] as const)('restores a %s seek made while the audio is recovering', async (control) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response))
    const { result, audio, player } = playingSource()
    act(() => result.current.handleAudioReady())
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => {
      if (control === '±5 s') {
        result.current.seekRelative(5)
      } else if (control === 'scrubber') {
        result.current.handleMiniScrubStart()
        result.current.handleMiniScrub(0.5)
        result.current.handleMiniScrubEnd()
      } else {
        result.current.handleMiniSeek(0.25)
      }
    })
    // The element is reloading, so its own time is not the held position.
    expect(player.seekRelative).not.toHaveBeenCalled()
    act(() => {
      audio.error = null
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(audio.currentTime).toBe({ '±5 s': 47, scrubber: 30, keyboard: 15 }[control])
  })

  it('keeps an explicit seek to zero when audio fails before seeked updates the clock', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response))
    const { result, audio } = playingSource()
    act(() => {
      result.current.handleAudioReady()
      result.current.onWordClick('s1', 0)
    })
    expect(audio.currentTime).toBe(0)
    expect(result.current.playbackClock.getMs()).toBe(42_000)

    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => {
      audio.error = null
      audio.dispatchEvent(new Event('loadstart'))
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(audio.currentTime).toBe(0)
    expect(result.current.playbackClock.getMs()).toBe(0)
  })

  it('uses the live position after an earlier seek has completed', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response))
    const { result, audio } = playingSource()
    act(() => {
      result.current.handleAudioReady()
      result.current.onWordClick('s1', 0)
      result.current.handleSeeked()
    })
    audio.currentTime = 12
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => {
      audio.error = null
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    expect(audio.currentTime).toBe(12)
  })

  it('plays the healthy source immediately while a proactive URL fetch is pending', async () => {
    let resolveFetch!: (response: Response) => void
    const fetch = jest.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    global.fetch = fetch as unknown as typeof global.fetch
    const { result, audio, props } = playingSource()
    audio.paused = true
    act(() => {
      result.current.handlePlayingChange(false)
      jest.setSystemTime(Date.now() + 51 * 60 * 1000)
    })
    await act(async () => { audio.dispatchEvent(new Event('stalled')) })
    expect(fetch).toHaveBeenCalledTimes(1)

    act(() => result.current.togglePlay())
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(props.setAudioSrc).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response)
    })
    expect(props.setAudioSrc).toHaveBeenCalledWith('fresh.mp3')
  })

  it('reloads the player when the signer returns the current URL', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'audio.mp3' }) })) as unknown as typeof fetch
    const { audio, player, props } = playingSource()
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    expect(player.reload).toHaveBeenCalledTimes(1)
    expect(props.setAudioSrc).not.toHaveBeenCalled()
  })

  it('holds the clock across reset frames and terminal failure', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) })) as unknown as typeof fetch
    const { result, audio, props } = playingSource()
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    expect(props.setAudioSrc).toHaveBeenCalledWith('fresh.mp3')
    act(() => {
      audio.error = null
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      result.current.handleTimeUpdate(0)
      result.current.handleSeeked()
      jest.advanceTimersByTime(32)
    })
    expect(result.current.playbackClock.getMs()).toBe(42000)
    act(() => { audio.error = mediaError; audio.dispatchEvent(new Event('error')) })
    expect(result.current.playing).toBe(false)
    expect(result.current.playbackClock.getMs()).toBe(42000)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('holds the clock during a successful proactive swap and resumes sampling after restoration', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) })) as unknown as typeof fetch
    const { result, audio } = playingSource()
    act(() => { jest.setSystemTime(Date.now() + 51 * 60 * 1000) })
    await act(async () => { audio.dispatchEvent(new Event('stalled')) })
    act(() => {
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      jest.advanceTimersByTime(32)
    })
    expect(result.current.playbackClock.getMs()).toBe(42000)
    act(() => { audio.dispatchEvent(new Event('loadeddata')) })
    expect(audio.currentTime).toBe(42)
    act(() => { audio.currentTime = 43; jest.advanceTimersByTime(32) })
    expect(result.current.playbackClock.getMs()).toBe(43000)
  })

  it('keeps the mini scrubber at the held position until the refreshed audio is ready', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) } as Response))
    const { result, audio, player } = playingSource()
    act(() => result.current.handleAudioReady())
    expect(result.current.audioProgress).toBe(70)

    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => {
      audio.error = null
      audio.currentTime = 0
      audio.dispatchEvent(new Event('loadstart'))
      player.getDuration.mockReturnValue(120)
      result.current.handleAudioDurationChange(120)
    })
    expect(result.current.audioCurrentTime).toBe(42)
    expect(result.current.audioProgress).toBe(70)

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      result.current.handleAudioReady()
    })
    expect(result.current.audioDuration).toBe(120)
    expect(result.current.audioProgress).toBe(35)
  })

  it('lets Play reach a stalled source after five seconds and restores a later load', async () => {
    const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ url: 'fresh.mp3' }) }))
    global.fetch = fetch as unknown as typeof global.fetch
    const { result, audio } = playingSource()
    audio.error = mediaError
    await act(async () => { audio.dispatchEvent(new Event('error')) })
    act(() => {
      audio.dispatchEvent(new Event('abort'))
      audio.error = null
      audio.currentTime = 0
      audio.paused = true
      result.current.handlePlayingChange(false)
      audio.dispatchEvent(new Event('emptied'))
      audio.dispatchEvent(new Event('loadstart'))
    })
    act(() => {
      jest.advanceTimersByTime(4999)
      result.current.togglePlay()
    })
    expect(audio.play).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(1); result.current.togglePlay() })
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
    expect(result.current.playbackClock.getMs()).toBe(42000)

    act(() => { audio.dispatchEvent(new Event('loadeddata')) })
    expect(audio.currentTime).toBe(42)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it.each(['fails', 'times out'] as const)('keeps playing when a healthy stale refresh %s', async (outcome) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = outcome === 'fails'
      ? jest.fn(async () => ({ ok: false, status: 503 } as Response))
      : jest.fn(() => new Promise<Response>(() => {}))
    const { result, audio } = playingSource()
    act(() => { jest.setSystemTime(Date.now() + 51 * 60 * 1000) })
    await act(async () => { audio.dispatchEvent(new Event('stalled')) })
    await act(async () => { jest.advanceTimersByTime(15_000) })
    await act(async () => { audio.dispatchEvent(new Event('stalled')) })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    act(() => { audio.currentTime = 43; jest.advanceTimersByTime(32) })
    expect(result.current.playing).toBe(true)
    expect(result.current.playbackClock.getMs()).toBe(43000)
    expect(toast).not.toHaveBeenCalled()
  })
})
