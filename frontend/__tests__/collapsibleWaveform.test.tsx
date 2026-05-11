import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import CollapsibleWaveform, { MiniWaveformProgress } from '@/components/CollapsibleWaveform'
import { TooltipProvider } from '@/components/ui/tooltip'

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
        <MiniWaveformProgress {...defaultMiniProps} {...props} />
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

  it('calls onScrub with correct fraction on mouse down at 50%', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 200)

    fireEvent.mouseDown(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledWith(0.5)
  })

  it('calls onScrub with 0 on mouse down at left edge', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 400)

    fireEvent.mouseDown(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('calls onScrub with 1 on mouse down at right edge', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 300)

    fireEvent.mouseDown(slider, { clientX: 300 })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('returns safe default when scrubber width is zero', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 0)

    fireEvent.mouseDown(slider, { clientX: 150 })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('clamps fraction to 0-1 for out-of-bounds drags', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 200)

    fireEvent.mouseDown(slider, { clientX: 50 })
    expect(onScrub).toHaveBeenCalledWith(0)

    onScrub.mockClear()

    fireEvent.mouseDown(slider, { clientX: 400 })
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
    fireEvent.mouseDown(slider, { clientX: 100 })
    expect(onScrub).toHaveBeenLastCalledWith(0.25)

    // drag to 75%
    act(() => {
      fireEvent.mouseMove(window, { clientX: 300 })
    })
    expect(onScrub).toHaveBeenLastCalledWith(0.75)

    // release
    act(() => {
      fireEvent.mouseUp(window)
    })

    // further moves should NOT trigger onScrub
    onScrub.mockClear()
    act(() => {
      fireEvent.mouseMove(window, { clientX: 200 })
    })
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('renders local drag preview during scrubbing and resets to prop progress on release', () => {
    const onScrub = jest.fn()
    renderMiniProgress({ audioProgress: 40, onScrub })
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 400)

    const getFill = () => slider.firstChild as HTMLElement

    expect(getFill().style.width).toBe('40%')

    fireEvent.mouseDown(slider, { clientX: 80 })
    expect(getFill().style.width).toBe('20%')

    act(() => {
      fireEvent.mouseMove(window, { clientX: 300 })
    })
    expect(getFill().style.width).toBe('75%')

    act(() => {
      fireEvent.mouseUp(window)
    })
    expect(getFill().style.width).toBe('40%')
  })

  it('renders progress bar at correct width', () => {
    renderMiniProgress({ audioProgress: 65 })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    const fill = slider.firstChild as HTMLElement
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
    fireEvent.mouseDown(slider)
    expect(onScrubStart).toHaveBeenCalledTimes(1)
    expect(onScrubEnd).not.toHaveBeenCalled()

    // Release
    act(() => {
      fireEvent.mouseUp(window)
    })
    expect(onScrubEnd).toHaveBeenCalledTimes(1)
  })

  it('does not call onScrubStart/onScrubEnd when onScrub is not provided', () => {
    const onScrubStart = jest.fn()
    const onScrubEnd = jest.fn()
    renderMiniProgress({ onScrubStart, onScrubEnd })
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })

    fireEvent.mouseDown(slider)
    expect(onScrubStart).not.toHaveBeenCalled()

    act(() => {
      fireEvent.mouseUp(window)
    })
    // onScrubEnd should not fire since drag never started (isDragging was never true)
    expect(onScrubEnd).not.toHaveBeenCalled()
  })
})
