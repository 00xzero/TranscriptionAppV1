import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { pointer } from './helpers/scrubPointer'
import AudioPlayer, { AudioPlayerRef } from '../components/AudioPlayer'
import { useTranscriptSync } from '@/app/editor/[id]/hooks/useTranscriptSync'
import type { Seg } from '@/app/editor/[id]/types'
import { Virtuoso } from 'react-virtuoso'
import { scrollToIndexMock } from '../__mocks__/react-virtuoso'
import { useEditorPlayback } from '@/app/editor/[id]/hooks/useEditorPlayback'
import type { PlaybackClock } from '@/app/editor/[id]/playbackClock'
import Waveform from '@/components/Waveform'
import { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import { TooltipProvider } from '../components/ui/tooltip'

jest.mock('@/app/editor/[id]/hooks/useAudioSessionRecovery', () => ({ useAudioSessionRecovery: jest.fn() }))

function mockProgressRect(el: HTMLElement, left: number, width: number) {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 48,
    height: 48,
    x: left,
    y: 0,
    toJSON: () => { },
  })
}

function setupAudioElement(audio: HTMLAudioElement, { duration = 120, paused = true }: { duration?: number, paused?: boolean } = {}) {
  let currentTime = 0
  let durationValue = duration
  let pausedState = paused
  const playCalls: number[] = []

  Object.defineProperty(audio, 'duration', {
    configurable: true,
    get: () => durationValue,
  })

  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value
    },
  })

  Object.defineProperty(audio, 'paused', {
    configurable: true,
    get: () => pausedState,
  })

  Object.defineProperty(audio, 'play', {
    configurable: true,
    value: jest.fn().mockImplementation(() => {
      playCalls.push(currentTime)
      pausedState = false
      audio.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }),
  })

  Object.defineProperty(audio, 'pause', {
    configurable: true,
    value: jest.fn().mockImplementation(() => {
      pausedState = true
      audio.dispatchEvent(new Event('pause'))
    }),
  })

  return {
    getCurrentTime: () => currentTime,
    setCurrentTime: (value: number) => {
      currentTime = value
    },
    setDuration: (value: number) => {
      durationValue = value
    },
    playMock: audio.play as jest.Mock,
    pauseMock: audio.pause as jest.Mock,
    playCalls,
  }
}

describe('AudioPlayer', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>
  let nextRafId: number
  const originalUserAgent = navigator.userAgent
  const originalVendor = navigator.vendor

  function setNavigator(userAgent: string, vendor: string): void {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: userAgent,
    })
    Object.defineProperty(navigator, 'vendor', {
      configurable: true,
      value: vendor,
    })
  }

  function setSafariNavigator(): void {
    setNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Apple Computer, Inc.'
    )
  }

  function setChromeNavigator(): void {
    setNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Google Inc.'
    )
  }

  beforeEach(() => {
    setNavigator(originalUserAgent, originalVendor)
    rafCallbacks = new Map()
    nextRafId = 0

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((cb: FrameRequestCallback) => {
        const id = ++nextRafId
        rafCallbacks.set(id, cb)
        return id
      }),
    })

    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((id: number) => {
        rafCallbacks.delete(id)
      }),
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    setNavigator(originalUserAgent, originalVendor)
  })

  const flushAnimationFrame = () => {
    act(() => {
      const pending = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      pending.forEach((cb) => cb(16))
    })
  }

  const renderReadyPlayer = ({
    paused = true,
    props = {},
  }: {
    paused?: boolean
    props?: Partial<React.ComponentProps<typeof AudioPlayer>>
  } = {}) => {
    render(<AudioPlayer src="test.mp3" hideControls {...props} />)

    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration: 120, paused })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
    })

    return { slider, audio, ...audioState }
  }

  const renderPlayer = ({
    paused = true,
    props = {},
    ready = false,
    duration = 120,
  }: {
    paused?: boolean
    props?: Partial<React.ComponentProps<typeof AudioPlayer>>
    ready?: boolean
    duration?: number
  } = {}) => {
    render(<AudioPlayer src="test.mp3" hideControls {...props} />)

    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration, paused })

    if (ready) {
      act(() => {
        audio.dispatchEvent(new Event('loadedmetadata'))
        audio.dispatchEvent(new Event('canplaythrough'))
      })
    }

    return { slider, audio, ...audioState }
  }

  const getProgressFill = (slider: HTMLElement) => slider.children[1] as HTMLElement
  const getMiniWaveformFill = (slider: HTMLElement) => slider.firstElementChild?.firstElementChild as HTMLElement

  it('calls onDragStart once and onDragEnd once for built-in drag scrubbing', () => {
    const onDragStart = jest.fn()
    const onDragEnd = jest.fn()
    const { slider } = renderReadyPlayer({ props: { onDragStart, onDragEnd } })

    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 55 })
    expect(onDragStart).toHaveBeenCalledTimes(1)

    act(() => {
      pointer.up(slider)
    })

    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('seeks immediately on press without entering the drag lifecycle', () => {
    const { slider, getCurrentTime } = renderReadyPlayer()

    pointer.down(slider, { clientX: 100 })

    expect(slider).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText('01:00')).toBeInTheDocument()
    expect(getCurrentTime()).toBe(60)
  })

  it('flushes the pending seek before playback resumes on mouseup', () => {
    const { slider, playCalls, pauseMock } = renderReadyPlayer({ paused: false })

    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 55 })
    expect(pauseMock).toHaveBeenCalledTimes(1)

    act(() => {
      pointer.move(slider, { clientX: 150 })
    })

    act(() => {
      pointer.up(slider)
    })

    expect(playCalls).toEqual([90])
  })

  it('does not autoplay on drag release when the audio started paused', () => {
    const { slider, playMock } = renderReadyPlayer({ paused: true })

    pointer.down(slider, { clientX: 50 })

    act(() => {
      pointer.move(slider, { clientX: 150 })
      pointer.up(slider)
    })

    expect(playMock).not.toHaveBeenCalled()
  })

  it('becomes ready on canplay even when canplaythrough has not fired', () => {
    const onReady = jest.fn()
    const { audio } = renderPlayer({ props: { onReady } })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
    })

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('primes Safari WebM playback with a tiny seek when the audio becomes ready', () => {
    setSafariNavigator()
    const onReady = jest.fn()
    const { audio, getCurrentTime } = renderPlayer({
      props: {
        src: 'https://storage.example.test/object/sign/media/user/transcript/recording.webm?token=abc',
        onReady,
      },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
    })

    expect(getCurrentTime()).toBe(0.001)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('does not prime Safari playback for non-WebM audio', () => {
    setSafariNavigator()
    const { audio, getCurrentTime } = renderPlayer({
      props: { src: 'recording.mp3' },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
    })

    expect(getCurrentTime()).toBe(0)
  })

  it('does not prime Chrome WebM playback', () => {
    setChromeNavigator()
    const { audio, getCurrentTime } = renderPlayer({
      props: { src: 'recording.webm' },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
    })

    expect(getCurrentTime()).toBe(0)
  })

  it('uses the supplied duration hint when media metadata has no finite duration', () => {
    const { audio } = renderPlayer({
      duration: Number.POSITIVE_INFINITY,
      props: { durationHint: 19 },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(screen.getByText('00:19')).toBeInTheDocument()
  })

  it('keeps finite media metadata over a longer duration hint by default', () => {
    const { audio } = renderPlayer({
      duration: 67,
      props: { durationHint: 78 },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(screen.getByText('01:07')).toBeInTheDocument()
  })

  it('uses a longer trusted duration hint when opted in', () => {
    const onDurationChange = jest.fn()
    const { audio } = renderPlayer({
      duration: 67,
      props: {
        durationHint: 78,
        preferLargerDurationHint: true,
        onDurationChange,
      },
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(screen.getByText('01:18')).toBeInTheDocument()
    expect(onDurationChange).toHaveBeenCalledWith(78)
  })

  it('scrubs against the trusted duration hint when it is longer than media metadata', () => {
    const playerRef = React.createRef<AudioPlayerRef>()
    render(
      <AudioPlayer
        ref={playerRef}
        src="test.mp3"
        hideControls
        durationHint={78}
        preferLargerDurationHint
      />
    )

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration: 67 })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
      playerRef.current?.scrubToFraction(0.75)
    })
    flushAnimationFrame()

    expect(audioState.getCurrentTime()).toBe(58.5)
    expect(screen.getByText('00:58')).toBeInTheDocument()
  })

  it('adopts a duration hint that arrives after media metadata', () => {
    const onDurationChange = jest.fn()
    const { rerender } = render(
      <AudioPlayer
        src="test.mp3"
        hideControls
        durationHint={null}
        onDurationChange={onDurationChange}
      />
    )

    const audio = document.querySelector('audio') as HTMLAudioElement
    setupAudioElement(audio, { duration: Number.POSITIVE_INFINITY })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    expect(screen.queryByText('00:19')).not.toBeInTheDocument()
    expect(onDurationChange).not.toHaveBeenCalled()

    rerender(
      <AudioPlayer
        src="test.mp3"
        hideControls
        durationHint={19}
        onDurationChange={onDurationChange}
      />
    )

    expect(screen.getByText('00:19')).toBeInTheDocument()
    expect(onDurationChange).toHaveBeenCalledWith(19)
  })

  it('exposes and clamps to the resolved duration through the imperative handle', () => {
    const playerRef = React.createRef<AudioPlayerRef>()
    render(
      <AudioPlayer
        ref={playerRef}
        src="test.mp3"
        hideControls
        durationHint={19}
      />
    )

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, {
      duration: Number.POSITIVE_INFINITY,
    })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
      playerRef.current?.seekToMs(25_000)
    })

    expect(playerRef.current?.getDuration()).toBe(19)
    expect(audioState.getCurrentTime()).toBe(19)
  })

  it('ignores stale timeupdate events while scrubbing', () => {
    const { slider, audio, setCurrentTime } = renderReadyPlayer()

    pointer.down(slider, { clientX: 140 })
    pointer.move(slider, { clientX: 150 })
    expect(slider).toHaveAttribute('aria-valuenow', '90')

    act(() => {
      setCurrentTime(10)
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(slider).toHaveAttribute('aria-valuenow', '90')
    expect(screen.getByText('01:30')).toBeInTheDocument()
  })

  it('shows immediate progress preview when scrubbing before metadata loads', () => {
    const { slider } = renderPlayer({ duration: 0 })

    pointer.down(slider, { clientX: 100 })

    expect(getProgressFill(slider).style.width).toBe('50%')
    expect(screen.getAllByText('00:00')).toHaveLength(2)
  })

  it('resolves a pending scrub preview when metadata arrives', () => {
    const onScrubPreview = jest.fn()
    const { slider, audio, getCurrentTime, setDuration } = renderPlayer({ props: { onScrubPreview }, duration: 0 })

    pointer.down(slider, { clientX: 100 })
    expect(getProgressFill(slider).style.width).toBe('50%')

    act(() => {
      setDuration(120)
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    flushAnimationFrame()

    expect(onScrubPreview).toHaveBeenLastCalledWith(60)
    expect(getCurrentTime()).toBe(60)
    expect(screen.getByText('01:00')).toBeInTheDocument()
    expect(getProgressFill(slider).style.width).toBe('50%')
  })

  it('supports imperative fraction scrubs before metadata loads', () => {
    const playerRef = React.createRef<AudioPlayerRef>()
    render(<AudioPlayer ref={playerRef} src="test.mp3" hideControls />)

    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration: 0, paused: true })

    act(() => {
      playerRef.current?.beginScrub()
      playerRef.current?.scrubToFraction(0.75)
    })

    expect(getProgressFill(slider).style.width).toBe('75%')

    act(() => {
      audioState.setDuration(120)
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    flushAnimationFrame()

    expect(audioState.getCurrentTime()).toBe(90)
    expect(screen.getByText('01:30')).toBeInTheDocument()
  })

  it('exposes the imperative player handle to callback refs used by the editor', () => {
    const callbackRef = jest.fn()

    render(<AudioPlayer ref={callbackRef} src="test.mp3" hideControls />)

    const player = callbackRef.mock.calls.find(([value]) => value)?.[0] as AudioPlayerRef | undefined

    expect(player).toBeDefined()
    expect(typeof player?.togglePlay).toBe('function')
    expect(typeof player?.getDuration).toBe('function')
  })

  it('keeps audio events wired after switching to engine-only mode', () => {
    const onReady = jest.fn()
    const onPlayingChange = jest.fn()
    const onTimeUpdate = jest.fn()

    const { rerender } = render(
      <AudioPlayer
        src="test.mp3"
        hideControls
        onReady={onReady}
        onPlayingChange={onPlayingChange}
        onTimeUpdate={onTimeUpdate}
      />
    )

    let audio = document.querySelector('audio') as HTMLAudioElement
    setupAudioElement(audio, { duration: 120, paused: true })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
    })

    rerender(
      <AudioPlayer
        src="test.mp3"
        hideControls
        audioEngineOnly
        onReady={onReady}
        onPlayingChange={onPlayingChange}
        onTimeUpdate={onTimeUpdate}
      />
    )

    audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration: 120, paused: true })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
      audioState.setCurrentTime(12)
      audio.play()
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onPlayingChange).toHaveBeenLastCalledWith(true)
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12)
  })

  it('preserves the same audio node, readiness, rate, position and play state across both mode switches', () => {
    const playerRef = React.createRef<AudioPlayerRef>()
    const onReady = jest.fn()
    const onPlayingChange = jest.fn()
    const props = { ref: playerRef, src: 'test.mp3', onReady, onPlayingChange }
    const { rerender } = render(<AudioPlayer {...props} />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    const state = setupAudioElement(audio)
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
      playerRef.current?.setPlaybackRate(1.5)
      state.setCurrentTime(37)
      audio.play()
      audio.dispatchEvent(new Event('timeupdate'))
    })
    rerender(<AudioPlayer {...props} audioEngineOnly />)
    expect(document.querySelector('audio')).toBe(audio)
    expect(audio.currentTime).toBe(37)
    expect(audio.paused).toBe(false)
    expect(audio.playbackRate).toBe(1.5)
    expect(playerRef.current?.isReady()).toBe(true)
    expect(playerRef.current?.getDuration()).toBe(120)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onPlayingChange.mock.calls).toEqual([[true]])
    expect(state.pauseMock).not.toHaveBeenCalled()
    expect(state.playMock).toHaveBeenCalledTimes(1)
    act(() => {
      state.setCurrentTime(47)
      audio.dispatchEvent(new Event('timeupdate'))
    })
    rerender(<AudioPlayer {...props} />)
    expect(document.querySelector('audio')).toBe(audio)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '47')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(state.playMock).toHaveBeenCalledTimes(1)
  })

  it.each([[true, 'drag'], [false, 'drag'], [true, 'press'], [false, 'press']] as const)('closes the editor seek and pinning when peaks arrive (initially paused: %s, gesture: %s)', (paused, gesture) => {
    const commitSeek = jest.fn((_ms: number) => undefined)
    const startSeek = jest.fn()
    const noop = jest.fn()
    const onAudioTick = jest.fn(() => undefined)
    function Harness({ peaks }: { peaks: boolean }) {
      const [seeking, setSeeking] = React.useState(false)
      const start = React.useCallback(() => { startSeek(); setSeeking(true) }, [])
      const commit = React.useCallback((ms: number) => { commitSeek(ms); setSeeking(false); return undefined }, [])
      const playback = useEditorPlayback({
        transcriptId: 'test', audioSrc: 'test.mp3', setAudioSrc: noop, setStatus: noop,
        onAudioTick, startSeek: start, previewSeek: onAudioTick, commitSeek: commit,
        onWordSeek: noop, onSegmentSeek: noop, setWaveformCollapsed: noop, shouldCollapseWaveform: () => false,
      })
      return <>
        <output data-testid="playing">{String(playback.playing)}</output>
        <output data-testid="seeking">{String(seeking)}</output>
        <output data-testid="pinned">{String(playback.expandedPlayerScrubbing)}</output>
        <AudioPlayer ref={playback.handleAudioPlayerRef} src="test.mp3" hideControls audioEngineOnly={peaks}
          onReady={playback.handleAudioReady} onTimeUpdate={playback.handleTimeUpdate}
          onPlayingChange={playback.handlePlayingChange} onDurationChange={playback.handleAudioDurationChange}
          onScrubPreview={playback.handleScrubPreview} onScrubPreviewFraction={playback.handleScrubPreviewFraction}
          onSeekStart={playback.handleExpandedSeekStart} onSeekEnd={playback.handleMiniSeekEnd}
          onDragStart={playback.handlePlayerDragStart} onDragEnd={playback.handlePlayerDragEnd} />
        {peaks && <Waveform peaks={[0.2, 0.8]} currentTime={playback.audioCurrentTime} duration={playback.audioDuration}
          onSeek={playback.handleMiniSeek} onScrub={playback.handleMiniScrub}
          onScrubStart={playback.handleExpandedScrubStart} onScrubEnd={playback.handleExpandedScrubEnd} />}
      </>
    }
    const { rerender } = render(<Harness peaks={false} />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    const state = setupAudioElement(audio, { paused })
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
      if (!paused) audio.dispatchEvent(new Event('play'))
    })
    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)
    pointer.down(slider, { clientX: 50 })
    if (gesture === 'drag') pointer.move(slider, { clientX: 150 })
    const expectedTime = gesture === 'drag' ? 90 : 30
    expect(screen.getByTestId('seeking')).toHaveTextContent('true')
    expect(screen.getByTestId('pinned')).toHaveTextContent('true')
    rerender(<Harness peaks />)
    expect(document.querySelector('audio')).toBe(audio)
    expect(audio.currentTime).toBe(expectedTime)
    expect(audio.paused).toBe(paused)
    expect(screen.getByTestId('playing')).toHaveTextContent(String(!paused))
    expect(screen.getByTestId('seeking')).toHaveTextContent('false')
    expect(screen.getByTestId('pinned')).toHaveTextContent('false')
    expect(commitSeek).toHaveBeenLastCalledWith(expectedTime * 1000)
    expect(startSeek).toHaveBeenCalledTimes(1)
    expect(state.playMock).toHaveBeenCalledTimes(!paused && gesture === 'drag' ? 1 : 0)
    expect(state.pauseMock).toHaveBeenCalledTimes(!paused && gesture === 'drag' ? 1 : 0)
    flushAnimationFrame()
    expect(audio.currentTime).toBe(expectedTime)
  })

  it.each(['expanded', 'mini', 'fallback'] as const)('keeps the %s control available throughout follow-mode scrolling and resumes follow on release', (kind) => {
    const segments = [
      { id: 's1', start_ms: 0, end_ms: 60000, text: 'First' },
      { id: 's2', start_ms: 60001, end_ms: 120000, text: 'Second' },
    ] as Seg[]
    const noop = jest.fn()
    function Harness() {
      const sync = useTranscriptSync({ segments, editingId: null, speakerPopover: null })
      const playback = useEditorPlayback({
        transcriptId: 'test', audioSrc: 'test.mp3', setAudioSrc: noop, setStatus: noop,
        onAudioTick: sync.onAudioTick, startSeek: sync.startSeek, previewSeek: sync.previewSeek, commitSeek: sync.commitSeek,
        onWordSeek: sync.onWordSeek, onSegmentSeek: sync.onSegmentSeek,
        setWaveformCollapsed: sync.setWaveformCollapsed, shouldCollapseWaveform: sync.shouldCollapseForCurrentScroll,
      })
      const collapsed = sync.waveformCollapsed && !playback.expandedPlayerScrubbing
      return <TooltipProvider>
        <output data-testid="following">{String(sync.isFollowMode)}</output>
        <output data-testid="seeking">{String(sync.mode === 'seeking')}</output>
        <div inert={!collapsed}>
          <MiniWaveformProgress audioProgress={playback.audioProgress} duration={playback.audioDuration} interactive={collapsed}
            onSeek={playback.handleMiniSeek} onSeekStart={playback.handleMiniSeekStart} onSeekEnd={playback.handleMiniSeekEnd}
            onScrub={playback.handleMiniScrub} onScrubStart={playback.handleMiniScrubStart} onScrubEnd={playback.handleMiniScrubEnd} />
        </div>
        <div ref={sync.scrollContainerRef} data-testid="scroll">
          <div inert={collapsed}>
            <AudioPlayer ref={playback.handleAudioPlayerRef} src="test.mp3" hideControls audioEngineOnly={kind !== 'fallback'} interactive={!collapsed}
              onReady={playback.handleAudioReady} onTimeUpdate={playback.handleTimeUpdate} onPlayingChange={playback.handlePlayingChange}
              onDurationChange={playback.handleAudioDurationChange} onScrubPreview={playback.handleScrubPreview}
              onScrubPreviewFraction={playback.handleScrubPreviewFraction} onSeekStart={playback.handleExpandedSeekStart}
              onSeekEnd={playback.handleMiniSeekEnd} onDragStart={playback.handlePlayerDragStart} onDragEnd={playback.handlePlayerDragEnd} />
            {kind === 'expanded' && <Waveform peaks={[0.2, 0.8]} currentTime={playback.audioCurrentTime} duration={playback.audioDuration} interactive={!collapsed}
              onSeek={playback.handleMiniSeek} onSeekStart={playback.handleExpandedSeekStart} onSeekEnd={playback.handleMiniSeekEnd}
              onScrub={playback.handleMiniScrub} onScrubStart={playback.handleExpandedScrubStart} onScrubEnd={playback.handleExpandedScrubEnd} />}
          </div>
          <Virtuoso ref={sync.virtuosoRef} data={[]} itemContent={() => null} />
          {segments.map(segment => <div key={segment.id} data-segment-id={segment.id}>{segment.text}</div>)}
        </div>
      </TooltipProvider>
    }
    render(<Harness />)
    const scroll = screen.getByTestId('scroll')
    jest.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 300, height: 300, width: 200 } as DOMRect)
    segments.forEach((segment, index) => {
      const card = document.querySelector(`[data-segment-id="${segment.id}"]`) as HTMLElement
      jest.spyOn(card, 'getBoundingClientRect').mockImplementation(() => {
        const top = index * 1000 - scroll.scrollTop
        return { top, bottom: top + 100, height: 100, width: 200 } as DOMRect
      })
    })
    // Model actual Virtuoso follow scrolling instead of leaving the mock inert.
    scrollToIndexMock.mockImplementation(({ index }: { index: number }) => {
      scroll.scrollTop = index * 1000
      fireEvent.scroll(scroll)
    })
    const audio = document.querySelector('audio') as HTMLAudioElement
    const state = setupAudioElement(audio, { paused: false })
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('canplay')); audio.dispatchEvent(new Event('play')) })
    if (kind === 'mini') act(() => { scroll.scrollTop = 600; fireEvent.scroll(scroll) })
    const name = kind === 'expanded' ? 'Audio waveform' : kind === 'mini' ? 'Audio scrubber' : 'Audio progress'
    const slider = screen.getByRole('slider', { name })
    mockProgressRect(slider, 0, 200)
    pointer.down(slider, { clientX: 150 })
    expect(audio.currentTime).toBe(90)
    expect(screen.getByTestId('seeking')).toHaveTextContent('true')
    expect(slider.closest('[inert]')).toBeNull()
    expect(state.pauseMock).not.toHaveBeenCalled()
    pointer.move(slider, { clientX: 10 })
    expect(audio.paused).toBe(true)
    expect(slider.closest('[inert]')).toBeNull()
    expect(scroll.scrollTop).toBe(0)
    pointer.move(slider, { clientX: 190 })
    expect(slider.closest('[inert]')).toBeNull()
    expect(scroll.scrollTop).toBe(1000)
    pointer.up(slider)
    expect(audio.currentTime).toBe(114)
    expect(screen.getByTestId('seeking')).toHaveTextContent('false')
    expect(screen.getByTestId('following')).toHaveTextContent('true')
    expect(state.playCalls).toEqual([114])
    scrollToIndexMock.mockReset()
  })

  it('does not pause/resume for a fallback click or tiny wobble', () => {
    const onDragStart = jest.fn()
    const { slider, audio, playMock, pauseMock } = renderReadyPlayer({ paused: false, props: { onDragStart } })
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 51 })
    pointer.up(slider)
    expect(audio.currentTime).toBe(30)
    expect(onDragStart).not.toHaveBeenCalled()
    expect(playMock).not.toHaveBeenCalled()
    expect(pauseMock).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'lost'] as const)('flushes the latest preview and resumes once after %s', (event) => {
    const onDragEnd = jest.fn()
    const { slider, audio, playMock } = renderReadyPlayer({ paused: false, props: { onDragEnd } })
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    pointer[event](slider)
    pointer.up(slider)
    expect(audio.currentTime).toBe(90)
    expect(playMock).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(0.75, 'cancellation')
  })

  it('closes a drag without resuming on source change or full unmount', () => {
    const onDragEnd = jest.fn()
    const props = { src: 'test.mp3', hideControls: true, onDragEnd }
    const { rerender, unmount } = render(<AudioPlayer {...props} />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    const state = setupAudioElement(audio, { paused: false })
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('canplay')) })
    const slider = screen.getByRole('slider')
    mockProgressRect(slider, 0, 200)
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    rerender(<AudioPlayer {...props} src="new.mp3" />)
    expect(onDragEnd).toHaveBeenLastCalledWith(0.75, 'teardown')
    expect(state.playMock).not.toHaveBeenCalled()
    act(() => { audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('canplay')); audio.play() })
    state.playMock.mockClear()
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 100 })
    unmount()
    expect(onDragEnd).toHaveBeenLastCalledWith(0.5, 'teardown')
    expect(state.playMock).not.toHaveBeenCalled()
  })

  it('lets a pre-ready scrub override an older queued imperative seek', () => {
    const playerRef = React.createRef<AudioPlayerRef>()
    render(<AudioPlayer ref={playerRef} src="test.mp3" hideControls />)

    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    const audioState = setupAudioElement(audio, { duration: 120, paused: true })

    act(() => {
      playerRef.current?.seekToMs(30_000)
    })

    pointer.down(slider, { clientX: 100 })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
    })

    flushAnimationFrame()

    expect(audioState.getCurrentTime()).toBe(60)
    expect(screen.getByText('01:00')).toBeInTheDocument()
  })

  it('shows a pending preview for click seeks before metadata loads', () => {
    const { slider } = renderPlayer({ duration: 0 })

    pointer.down(slider, { clientX: 150 })

    expect(getProgressFill(slider).style.width).toBe('75%')
  })

  it('keeps the collapsed waveform in sync when follow-mode collapse happens mid-drag', async () => {
    function TransitionHarness() {
      const [collapsed, setCollapsed] = React.useState(false)
      const [audioProgress, setAudioProgress] = React.useState(0)

      return (
        <>
          {collapsed && <MiniWaveformProgress audioProgress={audioProgress} duration={0} />}
          <AudioPlayer
            src="test.mp3"
            hideControls
            onScrubPreviewFraction={(fraction) => {
              setAudioProgress(fraction * 100)
              setCollapsed(true)
            }}
          />
        </>
      )
    }

    render(
      <TooltipProvider delayDuration={0}>
        <TransitionHarness />
      </TooltipProvider>
    )

    const playerSlider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(playerSlider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    setupAudioElement(audio, { duration: 0, paused: true })

    pointer.down(playerSlider, { clientX: 100 })

    const miniSlider = await screen.findByRole('slider', { name: 'Audio scrubber' })
    expect(getMiniWaveformFill(miniSlider).style.width).toBe('50%')

    act(() => {
      pointer.move(playerSlider, { clientX: 150 })
    })

    expect(getMiniWaveformFill(miniSlider).style.width).toBe('75%')
  })

  it('moves the playback clock to a paused scrub position only once the audio has moved there', () => {
    let clock: PlaybackClock | null = null
    const noop = jest.fn()
    function Harness() {
      const playback = useEditorPlayback({
        transcriptId: 'test', audioSrc: 'test.mp3', setAudioSrc: noop, setStatus: noop,
        onAudioTick: () => undefined, startSeek: noop, previewSeek: () => undefined, commitSeek: () => undefined,
        onWordSeek: noop, onSegmentSeek: noop, setWaveformCollapsed: noop, shouldCollapseWaveform: () => false,
      })
      clock = playback.playbackClock
      return <AudioPlayer ref={playback.handleAudioPlayerRef} src="test.mp3" hideControls
        onReady={playback.handleAudioReady} onTimeUpdate={playback.handleTimeUpdate} onSeeked={playback.handleSeeked}
        onPlayingChange={playback.handlePlayingChange} onDurationChange={playback.handleAudioDurationChange}
        onScrubPreview={playback.handleScrubPreview} onScrubPreviewFraction={playback.handleScrubPreviewFraction}
        onSeekStart={playback.handleExpandedSeekStart} onSeekEnd={playback.handleMiniSeekEnd}
        onDragStart={playback.handlePlayerDragStart} onDragEnd={playback.handlePlayerDragEnd} />
    }
    render(<Harness />)
    const audio = document.querySelector('audio') as HTMLAudioElement
    setupAudioElement(audio, { paused: true })
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplay'))
    })
    const slider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(slider, 0, 200)
    // jsdom never fires `seeked`; the real element does once a position write lands.
    const seeked = () => act(() => { audio.dispatchEvent(new Event('seeked')) })

    // Nothing has played or seeked, so there is no position to highlight.
    expect(clock!.getMs()).toBeNull()

    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    // The scrub preview has fired, but its rAF has not written the position yet.
    expect(audio.currentTime).not.toBe(90)
    expect(clock!.getMs()).toBeNull()

    flushAnimationFrame()
    seeked()
    expect(clock!.getMs()).toBe(90000)

    pointer.move(slider, { clientX: 180 })
    expect(clock!.getMs()).toBe(90000)
    pointer.up(slider, { clientX: 180 })
    seeked()
    expect(audio.currentTime).toBe(108)
    expect(audio.paused).toBe(true)
    expect(clock!.getMs()).toBe(108000)
  })
})
