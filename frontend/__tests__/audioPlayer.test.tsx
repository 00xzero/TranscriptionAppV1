import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AudioPlayer, { AudioPlayerRef } from '../components/AudioPlayer'
import CollapsibleWaveform from '../components/CollapsibleWaveform'

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

  beforeEach(() => {
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
  const getMiniWaveformFill = (slider: HTMLElement) => slider.firstChild as HTMLElement

  it('calls onDragStart once and onDragEnd once for built-in drag scrubbing', () => {
    const onDragStart = jest.fn()
    const onDragEnd = jest.fn()
    const { slider } = renderReadyPlayer({ props: { onDragStart, onDragEnd } })

    fireEvent.mouseDown(slider, { clientX: 50 })
    expect(onDragStart).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.mouseUp(window)
    })

    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('updates local progress immediately before the rAF seek flushes', () => {
    const { slider, getCurrentTime } = renderReadyPlayer()

    fireEvent.mouseDown(slider, { clientX: 100 })

    expect(slider).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText('1:00')).toBeInTheDocument()
    expect(getCurrentTime()).toBe(0)

    flushAnimationFrame()

    expect(getCurrentTime()).toBe(60)
  })

  it('flushes the pending seek before playback resumes on mouseup', () => {
    const { slider, playCalls, pauseMock } = renderReadyPlayer({ paused: false })

    fireEvent.mouseDown(slider, { clientX: 50 })
    expect(pauseMock).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent.mouseMove(window, { clientX: 150 })
    })

    act(() => {
      fireEvent.mouseUp(window)
    })

    expect(playCalls).toEqual([90])
  })

  it('does not autoplay on drag release when the audio started paused', () => {
    const { slider, playMock } = renderReadyPlayer({ paused: true })

    fireEvent.mouseDown(slider, { clientX: 50 })

    act(() => {
      fireEvent.mouseMove(window, { clientX: 150 })
      fireEvent.mouseUp(window)
    })

    expect(playMock).not.toHaveBeenCalled()
  })

  it('ignores stale timeupdate events while scrubbing', () => {
    const { slider, audio, setCurrentTime } = renderReadyPlayer()

    fireEvent.mouseDown(slider, { clientX: 150 })
    expect(slider).toHaveAttribute('aria-valuenow', '90')

    act(() => {
      setCurrentTime(10)
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(slider).toHaveAttribute('aria-valuenow', '90')
    expect(screen.getByText('1:30')).toBeInTheDocument()
  })

  it('shows immediate progress preview when scrubbing before metadata loads', () => {
    const { slider } = renderPlayer({ duration: 0 })

    fireEvent.mouseDown(slider, { clientX: 100 })

    expect(getProgressFill(slider).style.width).toBe('50%')
    expect(screen.getAllByText('0:00')).toHaveLength(2)
  })

  it('resolves a pending scrub preview when metadata arrives', () => {
    const onScrubPreview = jest.fn()
    const { slider, audio, getCurrentTime, setDuration } = renderPlayer({ props: { onScrubPreview }, duration: 0 })

    fireEvent.mouseDown(slider, { clientX: 100 })
    expect(getProgressFill(slider).style.width).toBe('50%')

    act(() => {
      setDuration(120)
      audio.dispatchEvent(new Event('loadedmetadata'))
    })

    flushAnimationFrame()

    expect(onScrubPreview).toHaveBeenLastCalledWith(60)
    expect(getCurrentTime()).toBe(60)
    expect(screen.getByText('1:00')).toBeInTheDocument()
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
    expect(screen.getByText('1:30')).toBeInTheDocument()
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

    fireEvent.mouseDown(slider, { clientX: 100 })

    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('canplaythrough'))
    })

    flushAnimationFrame()

    expect(audioState.getCurrentTime()).toBe(60)
    expect(screen.getByText('1:00')).toBeInTheDocument()
  })

  it('shows a pending preview for click seeks before metadata loads', () => {
    const { slider } = renderPlayer({ duration: 0 })

    fireEvent.click(slider, { clientX: 150 })

    expect(getProgressFill(slider).style.width).toBe('75%')
  })

  it('keeps the collapsed waveform in sync when follow-mode collapse happens mid-drag', async () => {
    function TransitionHarness() {
      const [collapsed, setCollapsed] = React.useState(false)
      const [audioProgress, setAudioProgress] = React.useState(0)

      return (
        <CollapsibleWaveform collapsed={collapsed} audioProgress={audioProgress}>
          <AudioPlayer
            src="test.mp3"
            hideControls
            onScrubPreviewFraction={(fraction) => {
              setAudioProgress(fraction * 100)
              setCollapsed(true)
            }}
          />
        </CollapsibleWaveform>
      )
    }

    render(<TransitionHarness />)

    const playerSlider = screen.getByRole('slider', { name: 'Audio progress' })
    mockProgressRect(playerSlider, 0, 200)

    const audio = document.querySelector('audio') as HTMLAudioElement
    setupAudioElement(audio, { duration: 0, paused: true })

    fireEvent.mouseDown(playerSlider, { clientX: 100 })

    const miniSlider = await screen.findByRole('slider', { name: 'Audio scrubber' })
    expect(getMiniWaveformFill(miniSlider).style.width).toBe('50%')

    act(() => {
      fireEvent.mouseMove(window, { clientX: 150 })
    })

    expect(getMiniWaveformFill(miniSlider).style.width).toBe('75%')
  })
})
