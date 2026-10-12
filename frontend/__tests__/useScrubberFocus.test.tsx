import { act, render, screen } from '@testing-library/react'
import { useScrubberFocus } from '@/lib/audio/useScrubberFocus'

function Harness({ collapsed = false, peaks = false }: { collapsed?: boolean; peaks?: boolean }) {
  const { attachExpanded, attachMini, trackExpandedFocus, trackMiniFocus, trackBlur } = useScrubberFocus(collapsed, peaks)
  return <>
    <button>Unrelated</button>
    <div ref={attachMini} inert={!collapsed} onFocusCapture={trackMiniFocus} onBlurCapture={trackBlur}>
      <div role="slider" aria-label="Mini" aria-valuenow={0} tabIndex={collapsed ? 0 : -1} />
    </div>
    <div ref={attachExpanded} inert={collapsed} onFocusCapture={trackExpandedFocus} onBlurCapture={trackBlur}>
      {peaks ? <div key="waveform" role="slider" aria-label="Waveform" aria-valuenow={0} tabIndex={collapsed ? -1 : 0} />
        : <div key="fallback" role="slider" aria-label="Fallback" aria-valuenow={0} tabIndex={collapsed ? -1 : 0} />}
    </div>
  </>
}

describe('scrubber focus ownership', () => {
  it('hands focus in both directions before/after wrappers become inert', () => {
    const { rerender } = render(<Harness peaks />)
    const waveform = screen.getByRole('slider', { name: 'Waveform' })
    const mini = screen.getByRole('slider', { name: 'Mini' })
    expect(mini.parentElement).toHaveAttribute('inert')
    act(() => waveform.focus())
    rerender(<Harness peaks collapsed />)
    expect(waveform.parentElement).toHaveAttribute('inert')
    expect(mini).toHaveFocus()
    const focus = jest.spyOn(waveform, 'focus')
    rerender(<Harness peaks />)
    expect(waveform).toHaveFocus()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('transfers focus when the fallback is removed as peaks arrive', () => {
    const { rerender } = render(<Harness />)
    act(() => screen.getByRole('slider', { name: 'Fallback' }).focus())
    rerender(<Harness peaks />)
    expect(screen.getByRole('slider', { name: 'Waveform' })).toHaveFocus()
  })

  it('does not reclaim focus after the user blurs the slider to body', () => {
    const { rerender } = render(<Harness peaks />)
    const slider = screen.getByRole('slider', { name: 'Waveform' })
    act(() => { slider.focus(); slider.blur() })
    rerender(<Harness peaks collapsed />)
    expect(document.body).toHaveFocus()
  })

  it('leaves unrelated focus alone during collapse and peaks arrival', () => {
    const { rerender } = render(<Harness />)
    act(() => screen.getByRole('slider', { name: 'Fallback' }).focus())
    const button = screen.getByRole('button', { name: 'Unrelated' })
    act(() => button.focus())
    rerender(<Harness peaks collapsed />)
    expect(button).toHaveFocus()
  })
})
