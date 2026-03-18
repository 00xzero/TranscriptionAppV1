import { renderHook, act } from '@testing-library/react'
import { useUserScrollDetection } from '@/app/editor/[id]/hooks/useUserScrollDetection'

describe('useUserScrollDetection', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('keeps touch intent active until the first scroll event arrives', () => {
    const container = document.createElement('div')
    const containerRef = { current: container }
    const onUserScroll = jest.fn()

    renderHook(() => useUserScrollDetection({
      containerRef,
      isProgrammaticScrollActive: () => false,
      onUserScroll,
    }))

    act(() => {
      container.dispatchEvent(new Event('touchstart'))
      jest.advanceTimersByTime(300)
      container.dispatchEvent(new Event('scroll'))
    })

    expect(onUserScroll).toHaveBeenCalledTimes(1)
  })

  it('expires wheel intent if no scroll follows shortly after', () => {
    const container = document.createElement('div')
    const containerRef = { current: container }
    const onUserScroll = jest.fn()

    renderHook(() => useUserScrollDetection({
      containerRef,
      isProgrammaticScrollActive: () => false,
      onUserScroll,
    }))

    act(() => {
      container.dispatchEvent(new Event('wheel'))
      jest.advanceTimersByTime(200)
      container.dispatchEvent(new Event('scroll'))
    })

    expect(onUserScroll).not.toHaveBeenCalled()
  })
})
