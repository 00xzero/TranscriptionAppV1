import { renderHook, act } from '@testing-library/react'
import { useTranscriptMutations } from '../../app/editor/[id]/hooks/useTranscriptMutations'

const mockUpdateSegment = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/supabase/queries', () => ({
  updateSegment: (...args: unknown[]) => mockUpdateSegment(...args),
}))

describe('useTranscriptMutations', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockUpdateSegment.mockClear()
    mockUpdateSegment.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('scheduleSave updates segments optimistically', () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(setSegments).toHaveBeenCalled()
  })

  it('scheduleSave calls updateSegment with text only', async () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    expect(mockUpdateSegment).toHaveBeenCalledWith('seg-1', { text: 'updated text' })
  })

  it('scheduleSave transitions status: saving -> saved -> idle', async () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.saveStatus['seg-1']).toBe('saving')

    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    expect(result.current.saveStatus['seg-1']).toBe('saved')

    act(() => {
      jest.advanceTimersByTime(1200)
    })

    expect(result.current.saveStatus['seg-1']).toBe('idle')
  })

  it('scheduleSave sets error status on failure', async () => {
    const setSegments = jest.fn()
    mockUpdateSegment.mockRejectedValueOnce(new Error('network error'))

    const { result } = renderHook(() =>
      useTranscriptMutations({ setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.saveStatus['seg-1']).toBe('saving')

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    expect(result.current.saveStatus['seg-1']).toBe('error')

    consoleSpy.mockRestore()
  })

  it('debounces rapid saves', async () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'first text')
    })

    act(() => {
      result.current.scheduleSave('seg-1', 'second text')
    })

    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    expect(mockUpdateSegment).toHaveBeenCalledTimes(1)
    expect(mockUpdateSegment).toHaveBeenCalledWith('seg-1', { text: 'second text' })
  })
})
