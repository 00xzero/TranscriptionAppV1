import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { pointer } from './helpers/scrubPointer'
import CollapsibleWaveform, { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import Waveform from '@/components/Waveform'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useScrubberFocus } from '@/lib/audio/useScrubberFocus'

function ScrubberHintFocusHarness({ collapsed = false }: { collapsed?: boolean }) {
  const { attachMini, attachExpanded, trackMiniFocus, trackExpandedFocus, trackBlur } = useScrubberFocus(collapsed, true)
  return (
    <TooltipProvider>
      <div ref={attachMini} inert={!collapsed} onFocusCapture={trackMiniFocus} onBlurCapture={trackBlur}>
        <MiniWaveformProgress audioProgress={40} duration={100} interactive={collapsed} onSeek={() => {}} />
      </div>
      <CollapsibleWaveform
        collapsed={collapsed}
        contentRef={attachExpanded}
        onFocusCapture={trackExpandedFocus}
        onBlurCapture={trackBlur}
      >
        <Waveform peaks={[0.2, 0.6, 0.4]} currentTime={40} duration={100} interactive={!collapsed} onSeek={() => {}} />
      </CollapsibleWaveform>
    </TooltipProvider>
  )
}

// Helper to mock getBoundingClientRect on the scrubber bar
function mockBarRect(el: HTMLElement, left: number, width: number) {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 6,
    height: 6,
    x: left,
    y: 0,
    toJSON: () => {},
  })
}

describe('CollapsibleWaveform', () => {
  const defaultShellProps = {
    collapsed: false,
    children: <div data-testid="waveform-content">Audio Player</div>,
  }

  const defaultMiniProps = {
    audioProgress: 40,
    duration: 100,
  }

  const renderWaveform = (props: Partial<React.ComponentProps<typeof CollapsibleWaveform>> = {}) =>
    render(
      <TooltipProvider delayDuration={0}>
        <CollapsibleWaveform {...defaultShellProps} {...props} />
      </TooltipProvider>
    )

  const renderMiniProgress = (props: Partial<React.ComponentProps<typeof MiniWaveformProgress>> = {}) =>
    render(
      <TooltipProvider delayDuration={0}>
        <MiniWaveformProgress {...defaultMiniProps} onSeek={props.onScrub} {...props} />
      </TooltipProvider>
    )

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders mini progress bar when collapsed', () => {
    renderMiniProgress()
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuenow', '40')
  })

  it('waits for a deliberate hover every time, even after another hint was shown', () => {
    renderMiniProgress({ onScrub: jest.fn() })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })

    pointer.move(slider)
    act(() => { jest.advanceTimersByTime(699) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => { jest.advanceTimersByTime(1) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')

    fireEvent(slider, new MouseEvent('pointerout', { bubbles: true, buttons: 0, relatedTarget: document.body }))
    pointer.move(slider)
    act(() => { jest.advanceTimersByTime(699) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => { jest.advanceTimersByTime(1) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')
  })

  it('cancels a pending hint on press and keeps it hidden through dragging and release', () => {
    renderMiniProgress({ onScrub: jest.fn() })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    mockBarRect(slider, 0, 400)

    pointer.move(slider, { clientX: 100 })
    act(() => { jest.advanceTimersByTime(150) })
    pointer.down(slider, { clientX: 100, buttons: 1 })
    pointer.move(slider, { clientX: 200, buttons: 1 })
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    pointer.up(slider, { buttons: 0 })
    pointer.move(slider, { clientX: 201, buttons: 0 })
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent(slider, new MouseEvent('pointerout', { bubbles: true, buttons: 0, relatedTarget: document.body }))
    pointer.move(slider, { clientX: 202, buttons: 0 })
    act(() => { jest.advanceTimersByTime(700) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')
  })

  it('dismisses an open hint on a plain seek and restores it for keyboard focus', () => {
    renderMiniProgress({ onScrub: jest.fn() })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    pointer.move(slider)
    act(() => { jest.advanceTimersByTime(700) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    pointer.down(slider)
    pointer.up(slider)
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.blur(slider)
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focus(slider)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')
  })

  it('does not show a hint for a hidden mini scrubber', () => {
    renderMiniProgress({ interactive: false, onScrub: jest.fn() })
    pointer.move(screen.getByRole('slider'))
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('suppresses the hint after a drag hands focus to the mini scrubber, until a fresh hover', () => {
    const { rerender } = render(<ScrubberHintFocusHarness />)
    const waveform = screen.getByRole('slider', { name: 'Audio waveform' })
    mockBarRect(waveform, 0, 200)
    pointer.down(waveform, { clientX: 50, buttons: 1 })
    pointer.move(waveform, { clientX: 100, buttons: 1 })
    pointer.up(waveform, { buttons: 0 })

    rerender(<ScrubberHintFocusHarness collapsed />)
    const mini = screen.getByRole('slider', { name: 'Audio scrubber' })
    expect(mini).toHaveFocus()
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Starting a new hover makes the hint available, with its usual delay.
    fireEvent(mini, new MouseEvent('pointerover', { bubbles: true, buttons: 0, relatedTarget: document.body }))
    pointer.move(mini, { buttons: 0 })
    act(() => { jest.advanceTimersByTime(699) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => { jest.advanceTimersByTime(1) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')
  })

  it('still shows the hint when keyboard focus transfers to the mini scrubber', () => {
    const { rerender } = render(<ScrubberHintFocusHarness />)
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => screen.getByRole('slider', { name: 'Audio waveform' }).focus())
    rerender(<ScrubberHintFocusHarness collapsed />)

    expect(screen.getByRole('slider', { name: 'Audio scrubber' })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scrub audio')
  })

  it('removes the mini progress bar from keyboard navigation when hidden', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ interactive: false, onScrub })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })

    expect(slider).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(slider, { key: 'End' })
    pointer.down(slider, { clientX: 100 })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('renders expanded waveform content without the mini bar', () => {
    renderWaveform({ collapsed: false })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByTestId('waveform-content')).toBeInTheDocument()
  })

  it('can pin the expanded waveform while a full-player scrub is active', () => {
    renderWaveform({ collapsed: false, pinned: true })
    const content = screen.getByTestId('waveform-content')
    expect(content.closest('.sticky')).not.toBeNull()
  })

  it('preserves layout height while the waveform content is collapsed', () => {
    renderWaveform({ collapsed: true, expandedHeight: 312 })
    const content = screen.getByTestId('waveform-content')
    const shell = content.closest('.relative.leading-none') as HTMLElement

    expect(shell).not.toBeNull()
    expect(shell.style.height).toBe('312px')
  })

  it('preserves a minimum layout height while the waveform content expands', () => {
    renderWaveform({ collapsed: false, expandedHeight: 312 })
    const content = screen.getByTestId('waveform-content')
    const shell = content.closest('.relative.leading-none') as HTMLElement

    expect(shell).not.toBeNull()
    expect(shell.style.minHeight).toBe('312px')
  })

  it('calls onScrub with correct fraction on mouse down at 50%', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 200)

    pointer.down(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledWith(0.5)
  })

  it('calls onScrub with 0 on mouse down at left edge', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 400)

    pointer.down(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('calls onScrub with 1 on mouse down at right edge', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 300)

    pointer.down(slider, { clientX: 300 })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('returns safe default when scrubber width is zero', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 0)

    pointer.down(slider, { clientX: 150 })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('clamps fraction to 0-1 for out-of-bounds drags', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 200)

    pointer.down(slider, { clientX: 50 })
    expect(onScrub).toHaveBeenCalledWith(0)

    onScrub.mockClear()

    pointer.up(slider)
    pointer.down(slider, { clientX: 400 })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('supports keyboard scrub-to-start with Home when onScrub is provided', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('supports keyboard scrubbing with arrow/end keys', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ audioProgress: 40, onScrub })
    const slider = screen.getByRole('slider')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onScrub).toHaveBeenLastCalledWith(0.45)

    fireEvent.keyDown(slider, { key: 'End' })
    expect(onScrub).toHaveBeenLastCalledWith(1)
  })

  it('supports drag-to-scrub via mousedown + mousemove + mouseup', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 400)

    // Start drag
    pointer.down(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenLastCalledWith(0.25)

    // drag to 75%
    act(() => {
      pointer.move(slider, { clientX: 300 })
    })
    expect(onScrub).toHaveBeenLastCalledWith(0.75)

    // release
    act(() => {
      pointer.up(slider)
    })

    // further moves should NOT trigger onScrub
    onScrub.mockClear()
    act(() => {
      pointer.move(slider, { clientX: 200 })
    })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('renders local drag preview during scrubbing and resets to prop progress on release', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ audioProgress: 40, onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 400)

    const getFill = () => slider.firstElementChild?.firstElementChild as HTMLElement

    expect(getFill().style.width).toBe('40%')

    pointer.down(slider, { clientX: 80 })
    expect(getFill().style.width).toBe('20%')

    act(() => {
      pointer.move(slider, { clientX: 300 })
    })
    expect(getFill().style.width).toBe('75%')

    act(() => {
      pointer.up(slider)
    })
    expect(getFill().style.width).toBe('40%')
  })

  it('renders progress bar at correct width', () => {
    renderMiniProgress({ audioProgress: 65 })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    const fill = slider.firstElementChild?.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('65%')
  })

  it('calls onScrubStart on drag start and onScrubEnd on drag end', () => {
    const onScrub = jest.fn()
    const onScrubStart = jest.fn()
    const onScrubEnd = jest.fn()
    renderMiniProgress({ onScrub, onScrubStart, onScrubEnd })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 400)

    // Start drag
    pointer.down(slider)
    pointer.move(slider, { clientX: 10 })
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    expect(onScrubEnd).not.toHaveBeenCalled()

    // Release
    act(() => {
      pointer.up(slider)
    })
    expect(onScrubEnd).toHaveBeenCalledTimes(1)
  })

  it('does not call onScrubStart/onScrubEnd when onScrub is not provided', () => {
    const onScrubStart = jest.fn()
    const onScrubEnd = jest.fn()
    renderMiniProgress({ onScrubStart, onScrubEnd })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })

    pointer.down(slider)
    expect(onScrubStart).not.toHaveBeenCalled()

    act(() => {
      pointer.up(slider)
    })
    // onScrubEnd should not fire since drag never started (isDragging was never true)
    expect(onScrubEnd).not.toHaveBeenCalled()
  })
})
