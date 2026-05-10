import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Waveform from '../components/Waveform'

function mockBoundingRect(el: HTMLElement, left: number, width: number) {
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 128,
        height: 128,
        x: left,
        y: 0,
        toJSON: () => { },
    })
}

describe('Waveform', () => {
    test('renders the bar grid with the testid hook', () => {
        const peaks = Array.from({ length: 2048 }, (_, i) => (i % 16) / 16)
        render(<Waveform peaks={peaks} currentTime={0} duration={120} />)
        expect(screen.getByTestId('waveform-bars')).toBeInTheDocument()
    })

    test('exposes ARIA slider attributes reflecting playback progress', () => {
        const peaks = new Array(2048).fill(0.3)
        const { rerender } = render(
            <Waveform peaks={peaks} currentTime={30} duration={120} />
        )
        const slider = screen.getByTestId('waveform-bars')
        expect(slider).toHaveAttribute('role', 'slider')
        expect(slider).toHaveAttribute('aria-valuemin', '0')
        expect(slider).toHaveAttribute('aria-valuemax', '100')
        expect(slider).toHaveAttribute('aria-valuenow', '25')

        rerender(<Waveform peaks={peaks} currentTime={60} duration={120} />)
        expect(slider).toHaveAttribute('aria-valuenow', '50')
    })

    test('drives --waveform-progress imperatively (no React state for playhead)', () => {
        const peaks = new Array(2048).fill(0.5)
        render(<Waveform peaks={peaks} currentTime={30} duration={120} />)
        const slider = screen.getByTestId('waveform-bars')
        // 30/120 = 25%
        expect(slider.style.getPropertyValue('--waveform-progress')).toBe('25.00%')
    })

    test('invokes onScrub with correct fraction on click', () => {
        const peaks = new Array(2048).fill(0.5)
        const onScrub = jest.fn()
        const onScrubStart = jest.fn()
        render(
            <Waveform
                peaks={peaks}
                currentTime={0}
                duration={120}
                onScrub={onScrub}
                onScrubStart={onScrubStart}
            />
        )
        const slider = screen.getByTestId('waveform-bars')
        mockBoundingRect(slider, 0, 1000)
        fireEvent.mouseDown(slider, { clientX: 250 })
        expect(onScrubStart).toHaveBeenCalledTimes(1)
        expect(onScrub).toHaveBeenCalledWith(0.25)
    })

    test('keyboard arrow keys scrub by 5% increments', () => {
        const peaks = new Array(2048).fill(0.5)
        const onScrub = jest.fn()
        render(
            <Waveform
                peaks={peaks}
                currentTime={60}
                duration={120}
                onScrub={onScrub}
            />
        )
        const slider = screen.getByTestId('waveform-bars')
        fireEvent.keyDown(slider, { key: 'ArrowRight' })
        // 60/120 = 0.5 → +0.05 = 0.55
        expect(onScrub).toHaveBeenLastCalledWith(0.55)
        fireEvent.keyDown(slider, { key: 'Home' })
        expect(onScrub).toHaveBeenLastCalledWith(0)
        fireEvent.keyDown(slider, { key: 'End' })
        expect(onScrub).toHaveBeenLastCalledWith(1)
    })

    test('handles zero duration without dividing by zero', () => {
        const peaks = new Array(2048).fill(0.5)
        render(<Waveform peaks={peaks} currentTime={0} duration={0} />)
        const slider = screen.getByTestId('waveform-bars')
        expect(slider).toHaveAttribute('aria-valuenow', '0')
        expect(slider.style.getPropertyValue('--waveform-progress')).toBe('0.00%')
    })
})
