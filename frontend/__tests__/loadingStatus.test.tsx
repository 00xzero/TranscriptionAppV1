import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { LoadingStatus } from '@/components/ui/loading-status'

test('adds loading text after the live region exists and clears a changed message', () => {
  jest.useFakeTimers()
  try {
    const { rerender } = render(<LoadingStatus message="Loading projects…" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')

    act(() => jest.advanceTimersByTime(99))
    expect(status.textContent).toBe('')
    act(() => jest.advanceTimersByTime(1))
    expect(status).toHaveTextContent('Loading projects…')

    rerender(<LoadingStatus message="Opening the nearest project…" />)
    expect(status.textContent).toBe('')
    act(() => jest.runOnlyPendingTimers())
    expect(status).toHaveTextContent('Opening the nearest project…')
  } finally {
    jest.useRealTimers()
  }
})
