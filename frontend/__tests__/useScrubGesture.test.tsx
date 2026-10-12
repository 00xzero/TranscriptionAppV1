import { fireEvent, render, screen } from '@testing-library/react'
import { useScrubGesture } from '@/lib/audio/useScrubGesture'
import { pointer } from './helpers/scrubPointer'

type Options = Parameters<typeof useScrubGesture>[0]
function Slider(props: Options) {
  const scrub = useScrubGesture(props)
  return <div role="slider" {...scrub.sliderProps} aria-valuenow={scrub.sliderProps['aria-valuenow']} style={{ touchAction: 'pan-y pinch-zoom' }}>
    <span data-testid="bar">Bar</span>
    <output>{scrub.isDragging ? 'dragging' : 'idle'}</output>
  </div>
}
function setup(overrides: Partial<Pick<Options, 'duration' | 'fraction' | 'interactive' | 'sourceKey'>> = {}) {
  const props = { duration: 120, fraction: 0.5, onSeek: jest.fn(), onScrubStart: jest.fn(), onScrub: jest.fn(), onScrubEnd: jest.fn(), ...overrides }
  const view = render(<Slider {...props} />)
  const slider = screen.getByRole('slider')
  jest.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect)
  return { ...view, slider, props }
}

describe('useScrubGesture', () => {
  it.each(['mouse', 'pen'])('seeks on %s press but tolerates a click wobble without a drag', (pointerType) => {
    const { slider, props } = setup()
    pointer.down(slider, { pointerType, clientX: 50 })
    pointer.move(slider, { clientX: 51, clientY: 1 })
    pointer.up(slider)
    expect(props.onSeek).toHaveBeenCalledTimes(1)
    expect(props.onSeek).toHaveBeenCalledWith(0.25)
    expect(props.onScrubStart).not.toHaveBeenCalled()
    expect(props.onScrubEnd).not.toHaveBeenCalled()
    expect(slider).toHaveFocus()
  })

  it('starts at 3px, ignores other pointers, and captures the root when a bar is pressed', () => {
    const { slider } = setup()
    const bar = screen.getByTestId('bar')
    pointer.down(bar, { clientX: 50, pointerId: 9 })
    expect(slider.setPointerCapture).toHaveBeenCalledWith(9)
    const capture = slider.setPointerCapture as jest.Mock
    expect(capture.mock.contexts.at(-1)).toBe(slider)
  })

  it('holds one seek transaction across press and drag, and closes an ordinary click too', () => {
    const onSeekStart = jest.fn()
    const onSeekEnd = jest.fn()
    const props = { duration: 120, fraction: 0, onSeek: jest.fn(), onSeekStart, onSeekEnd, onScrub: jest.fn(), onScrubStart: jest.fn(), onScrubEnd: jest.fn() }
    render(<Slider {...props} />)
    const slider = screen.getByRole('slider')
    jest.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 } as DOMRect)
    pointer.down(slider, { clientX: 50 })
    expect(onSeekStart).toHaveBeenCalledTimes(1)
    expect(onSeekEnd).not.toHaveBeenCalled()
    pointer.move(slider, { clientX: 150 })
    expect(onSeekStart).toHaveBeenCalledTimes(1)
    pointer.up(slider)
    expect(onSeekEnd).toHaveBeenCalledWith(0.75, 'release')
    pointer.down(slider, { clientX: 50 })
    pointer.up(slider)
    expect(onSeekEnd).toHaveBeenLastCalledWith(0.25, 'release')
    expect(onSeekEnd).toHaveBeenCalledTimes(2)
    expect(props.onScrubStart).toHaveBeenCalledTimes(1)
  })

  it('prevents native touch scrolling after horizontal intent, but permits it before acceptance and after release', () => {
    const { slider, props } = setup()
    const touchMove = () => fireEvent.touchMove(slider, { touches: [{ identifier: 1 }], cancelable: true })
    pointer.down(slider, { pointerType: 'touch', clientX: 50 })
    expect(touchMove()).toBe(true)
    pointer.move(slider, { clientX: 60, clientY: 2 })
    expect(touchMove()).toBe(false)
    pointer.move(slider, { clientX: 65, clientY: 26 })
    expect(touchMove()).toBe(false)
    pointer.move(slider, { clientX: 150, clientY: 30 })
    pointer.up(slider)
    expect(props.onScrubEnd).toHaveBeenCalledWith(0.75, 'release')
    expect(touchMove()).toBe(true)
  })

  it('suppresses pointer focus styling while retaining keyboard focus styling', () => {
    const { slider } = setup()
    pointer.down(slider)
    expect(slider).toHaveAttribute('data-scrub-pointer-focus', 'true')
    pointer.up(slider)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).not.toHaveAttribute('data-scrub-pointer-focus')
    pointer.down(slider)
    fireEvent.blur(slider)
    expect(slider).not.toHaveAttribute('data-scrub-pointer-focus')
  })

  it('tracks pointer IDs without depending on hasPointerCapture', () => {
    const { slider, props } = setup()
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 100, pointerId: 2 })
    pointer.up(slider, { pointerId: 2 })
    expect(props.onScrubStart).not.toHaveBeenCalled()
    pointer.move(slider, { clientX: 53, pointerId: 1 })
    pointer.move(slider, { clientX: 150 })
    pointer.up(slider, { clientX: 160 })
    expect(props.onScrubStart).toHaveBeenCalledTimes(1)
    expect(props.onScrub).toHaveBeenLastCalledWith(0.8)
    expect(props.onScrubEnd).toHaveBeenCalledWith(0.8, 'release')
  })

  it('seeks only on release for a touch tap', () => {
    const { slider, props } = setup()
    pointer.down(slider, { pointerType: 'touch', clientX: 50 })
    pointer.move(slider, { clientX: 52, clientY: 2 })
    expect(props.onSeek).not.toHaveBeenCalled()
    pointer.up(slider)
    expect(props.onSeek).toHaveBeenCalledWith(0.26)
    expect(props.onScrubStart).not.toHaveBeenCalled()
  })

  it('yields to vertical touch scrolling without seeking', () => {
    const { slider, props } = setup()
    pointer.down(slider, { pointerType: 'touch', clientX: 50 })
    expect(pointer.move(slider, { clientX: 52, clientY: 8 })).toBe(true)
    pointer.move(slider, { clientX: 150, clientY: 10 })
    pointer.up(slider)
    expect(props.onSeek).not.toHaveBeenCalled()
    expect(props.onScrubStart).not.toHaveBeenCalled()
    expect(slider.style.touchAction).toBe('pan-y pinch-zoom')
  })

  it('requires 8px of horizontal intent to start a touch drag', () => {
    const { slider, props } = setup()
    pointer.down(slider, { pointerType: 'touch', clientX: 50 })
    pointer.move(slider, { clientX: 57, clientY: 2 })
    expect(props.onScrubStart).not.toHaveBeenCalled()
    expect(pointer.move(slider, { clientX: 58, clientY: 2 })).toBe(false)
    pointer.up(slider, { clientX: 150 })
    expect(props.onSeek).not.toHaveBeenCalled()
    expect(props.onScrubEnd).toHaveBeenCalledWith(0.75, 'release')
  })

  it.each(['cancel', 'lost'] as const)('completes %s once at the latest preview', (event) => {
    const { slider, props } = setup()
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    pointer[event](slider)
    pointer.lost(slider)
    pointer.up(slider)
    expect(props.onScrubEnd).toHaveBeenCalledTimes(1)
    expect(props.onScrubEnd).toHaveBeenCalledWith(0.75, 'cancellation')
  })

  it('cancels on disabling and tears down on source replacement or unmount', () => {
    const { slider, props, rerender, unmount } = setup({ sourceKey: 'a' })
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    rerender(<Slider {...props} interactive={false} />)
    expect(props.onScrubEnd).toHaveBeenLastCalledWith(0.75, 'cancellation')
    rerender(<Slider {...props} />)
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 100 })
    rerender(<Slider {...props} sourceKey="b" />)
    expect(props.onScrubEnd).toHaveBeenLastCalledWith(0.5, 'teardown')
    pointer.down(slider, { clientX: 50 })
    pointer.move(slider, { clientX: 150 })
    unmount()
    expect(props.onScrubEnd).toHaveBeenLastCalledWith(0.75, 'teardown')
    expect(props.onScrubEnd).toHaveBeenCalledTimes(3)
  })

  it('ignores secondary buttons and extra pointer presses', () => {
    const { slider, props } = setup()
    pointer.down(slider, { button: 2 })
    pointer.down(slider, { button: 0, isPrimary: false })
    expect(props.onSeek).not.toHaveBeenCalled()
    pointer.down(slider, { isPrimary: true })
    pointer.down(slider, { pointerId: 2 })
    expect(props.onSeek).toHaveBeenCalledTimes(1)
  })

  it('uses seconds for keys and ARIA, and consumes Space without seeking or bubbling', () => {
    const { slider, props } = setup({ duration: 3600.8, fraction: 0.5 })
    expect(slider).toHaveAttribute('aria-valuemax', '3600')
    expect(slider).toHaveAttribute('aria-valuenow', '1800')
    expect(slider).toHaveAttribute('aria-valuetext', '00:30:00 of 01:00:00')
    for (const [key, step] of [['ArrowLeft', -5], ['ArrowRight', 5], ['PageDown', -30], ['PageUp', 30]] as const) {
      fireEvent.keyDown(slider, { key })
      expect(props.onSeek).toHaveBeenLastCalledWith(0.5 + step / 3600.8)
    }
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(props.onSeek).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(props.onSeek).toHaveBeenLastCalledWith(1)
    props.onSeek.mockClear()
    const bubbled = jest.fn()
    document.addEventListener('keydown', bubbled)
    expect(fireEvent.keyDown(slider, { key: ' ' })).toBe(false)
    expect(bubbled).not.toHaveBeenCalled()
    expect(props.onSeek).not.toHaveBeenCalled()
    document.removeEventListener('keydown', bubbled)
  })

  it('ignores relative keys when duration is unknown but allows endpoints', () => {
    const { slider, props } = setup({ duration: Infinity })
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(slider).toHaveAttribute('aria-valuetext', 'Duration unavailable')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(props.onSeek).not.toHaveBeenCalled()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(props.onSeek).toHaveBeenCalledWith(1)
  })
})
