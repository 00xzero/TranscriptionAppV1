import { renderHook, act } from '@testing-library/react'
import { useTranscriptMutations } from '../../app/editor/[id]/hooks/useTranscriptMutations'
import type { Seg } from '../../app/editor/[id]/types'

const mockUpdateChunk = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/supabase/queries', () => ({
  updateChunk: (...args: unknown[]) => mockUpdateChunk(...args),
}))

function makeSeg(overrides: Partial<Seg> = {}): Seg {
  return {
    id: 'seg-1',
    project_id: 'proj-1',
    speaker_id: 'spk-1',
    text: 'hello world',
    start_ms: 0,
    end_ms: 3000,
    index: 0,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Seg
}

describe('useTranscriptMutations', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockUpdateChunk.mockClear()
    mockUpdateChunk.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('scheduleSave updates segments optimistically', () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ source: 'chunks', setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(setSegments).toHaveBeenCalled()
  })

  it('scheduleSave transitions status: saving → saved → idle', async () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ source: 'chunks', setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    // Immediately after calling scheduleSave, status should be 'saving'
    expect(result.current.saveStatus['seg-1']).toBe('saving')

    // Advance past the debounce (10ms in test env) and flush the updateChunk promise
    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    // After the promise resolves, status should be 'saved'
    expect(result.current.saveStatus['seg-1']).toBe('saved')

    // Advance past the 1200ms reset timer
    act(() => {
      jest.advanceTimersByTime(1200)
    })

    expect(result.current.saveStatus['seg-1']).toBe('idle')
  })

  it('scheduleSave is no-op when source is segments', async () => {
    const setSegments = jest.fn()

    const { result } = renderHook(() =>
      useTranscriptMutations({ source: 'segments', setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    // Advance past debounce to ensure nothing fires
    await act(async () => {
      jest.advanceTimersByTime(10)
    })

    expect(setSegments).not.toHaveBeenCalled()
    expect(mockUpdateChunk).not.toHaveBeenCalled()
  })

  it('scheduleSave sets error status on failure', async () => {
    const setSegments = jest.fn()
    mockUpdateChunk.mockRejectedValueOnce(new Error('network error'))

    const { result } = renderHook(() =>
      useTranscriptMutations({ source: 'chunks', setSegments })
    )

    act(() => {
      result.current.scheduleSave('seg-1', 'updated text')
    })

    expect(result.current.saveStatus['seg-1']).toBe('saving')

    // Suppress the expected console.error from the hook's catch block
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
      useTranscriptMutations({ source: 'chunks', setSegments })
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

    // updateChunk should only have been called once, with the final text
    expect(mockUpdateChunk).toHaveBeenCalledTimes(1)
    expect(mockUpdateChunk).toHaveBeenCalledWith('seg-1', { text: 'second text' })
  })
})
