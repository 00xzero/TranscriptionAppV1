import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AudioPlayer from '../components/AudioPlayer'

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
  let pausedState = paused
  const playCalls: number[] = []

  Object.defineProperty(audio, 'duration', {
    configurable: true,
    get: () => duration,
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
})
