import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import CollapsibleWaveform from '../components/CollapsibleWaveform'

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
  const defaultProps = {
    collapsed: true,
    audioProgress: 40,
    onExpandClick: jest.fn(),
    children: <div data-testid="waveform-content">Audio Player</div>,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('renders mini progress bar when collapsed', () => {
    render(<CollapsibleWaveform {...defaultProps} />)
    const slider = screen.getByRole('slider', { name: 'Audio scrubber' })
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuenow', '40')
  })

  it('does not render mini bar when expanded', () => {
    render(<CollapsibleWaveform {...defaultProps} collapsed={false} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('calls onScrub with correct fraction on click at 50%', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 200)

    fireEvent.click(slider, { clientX: 100 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onScrub).toHaveBeenCalledWith(0.5)
  })

  it('calls onScrub with 0 on click at left edge', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 400)

    fireEvent.click(slider, { clientX: 100 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onScrub).toHaveBeenCalledWith(0)
  })

  it('calls onScrub with 1 on click at right edge', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 300)

    fireEvent.click(slider, { clientX: 300 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('clamps fraction to 0-1 for out-of-bounds clicks', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 100, 200)

    // Click before the bar
    fireEvent.click(slider, { clientX: 50 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onScrub).toHaveBeenCalledWith(0)

    onScrub.mockClear()

    // Click after the bar
    fireEvent.click(slider, { clientX: 400 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onScrub).toHaveBeenCalledWith(1)
  })

  it('calls onExpandClick on double-click (not onScrub)', () => {
    const onScrub = jest.fn()
    const onExpandClick = jest.fn()
    render(
      <CollapsibleWaveform
        {...defaultProps}
        onExpandClick={onExpandClick}
        onScrub={onScrub}
      />
    )
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 200)

    fireEvent.doubleClick(slider)
    act(() => {
      jest.advanceTimersByTime(300)
    })
    expect(onExpandClick).toHaveBeenCalledTimes(1)
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('single click does NOT call onExpandClick when onScrub is provided', () => {
    const onScrub = jest.fn()
    const onExpandClick = jest.fn()
    render(
      <CollapsibleWaveform
        {...defaultProps}
        onExpandClick={onExpandClick}
        onScrub={onScrub}
      />
    )
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 200)

    fireEvent.click(slider, { clientX: 100 })
    act(() => {
      jest.advanceTimersByTime(250)
    })
    expect(onExpandClick).not.toHaveBeenCalled()
    expect(onScrub).toHaveBeenCalled()
  })

  it('falls back to onExpandClick when onScrub is NOT provided', () => {
    const onExpandClick = jest.fn()
    render(
      <CollapsibleWaveform
        {...defaultProps}
        onExpandClick={onExpandClick}
      />
    )
    const slider = screen.getByRole('slider')

    fireEvent.click(slider)
    expect(onExpandClick).toHaveBeenCalledTimes(1)
  })

  it('supports keyboard expand with Home when onScrub is NOT provided', () => {
    const onExpandClick = jest.fn()
    render(
      <CollapsibleWaveform
        {...defaultProps}
        onExpandClick={onExpandClick}
      />
    )
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onExpandClick).toHaveBeenCalledTimes(1)
  })

  it('supports keyboard expand with Home even when onScrub is provided', () => {
    const onScrub = jest.fn()
    const onExpandClick = jest.fn()
    render(
      <CollapsibleWaveform
        {...defaultProps}
        onExpandClick={onExpandClick}
        onScrub={onScrub}
      />
    )
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onExpandClick).toHaveBeenCalledTimes(1)
    expect(onScrub).not.toHaveBeenCalled()
  })

  it('supports keyboard scrubbing with arrow/end keys', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} audioProgress={40} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')

    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onScrub).toHaveBeenLastCalledWith(0.45)

    fireEvent.keyDown(slider, { key: 'End' })
    expect(onScrub).toHaveBeenLastCalledWith(1)
  })

  it('supports drag-to-scrub via mousedown + mousemove + mouseup', () => {
    const onScrub = jest.fn()
    render(<CollapsibleWaveform {...defaultProps} onScrub={onScrub} />)
    const slider = screen.getByRole('slider')
    mockBarRect(slider, 0, 400)

    // Start drag
    fireEvent.mouseDown(slider, { clientX: 100 })
    expect(onScrub).not.toHaveBeenCalled()

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

  it('renders progress bar at correct width', () => {
    render(<CollapsibleWaveform {...defaultProps} audioProgress={65} />)
    const slider = screen.getByRole('slider')
    const fill = slider.firstChild as HTMLElement
    expect(fill.style.width).toBe('65%')
  })
})
