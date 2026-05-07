import { renderHook, act } from '@testing-library/react'
import { useTranscriptSearch } from '../../app/editor/[id]/hooks/useTranscriptSearch'
import type { Seg } from '../../app/editor/[id]/types'

const defaultParams = {
  segments: [
    { id: 's1', start_ms: 0, end_ms: 1000, text: 'Hello world', speaker_id: 'sp1', words: [{ key: 's1:0', start_ms: 0, end_ms: 500, text: 'Hello ' }, { key: 's1:1', start_ms: 500, end_ms: 1000, text: 'world' }] },
    { id: 's2', start_ms: 1000, end_ms: 2000, text: 'Hello again', speaker_id: 'sp1', words: [{ key: 's2:0', start_ms: 1000, end_ms: 1500, text: 'Hello ' }, { key: 's2:1', start_ms: 1500, end_ms: 2000, text: 'again' }] },
  ] as Seg[],
  editingTexts: {},
  setEditingTexts: jest.fn(),
  scheduleSave: jest.fn(),
  setEditingId: jest.fn(),
  scrollToSegmentIndex: jest.fn(),
  suspendFollow: jest.fn(),
  setSpeakerPopover: jest.fn(),
  closeSpeakerPopover: jest.fn(),
  exportModalOpen: false,
}

describe('useTranscriptSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    defaultParams.setEditingTexts.mockClear()
    defaultParams.scheduleSave.mockClear()
    defaultParams.setEditingId.mockClear()
    defaultParams.scrollToSegmentIndex.mockClear()
    defaultParams.suspendFollow.mockClear()
    defaultParams.setSpeakerPopover.mockClear()
    defaultParams.closeSpeakerPopover.mockClear()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('finds matches for a search term', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    act(() => {
      result.current.setFindInput('Hello')
    })

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.findTerm).toBe('Hello')
    expect(result.current.totalMatches).toBe(2)
    expect(result.current.matches).toHaveLength(2)
    expect(result.current.matches[0]).toEqual({ segId: 's1', index: 0, length: 5 })
    expect(result.current.matches[1]).toEqual({ segId: 's2', index: 0, length: 5 })
  })

  it('debounces find input to findTerm', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    act(() => {
      result.current.setFindInput('Hello')
    })

    expect(result.current.findTerm).toBe('')
    expect(result.current.isFindDirty).toBe(true)

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.findTerm).toBe('Hello')
    expect(result.current.isFindDirty).toBe(false)
  })

  it('case-sensitive search', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    act(() => {
      result.current.setCaseSensitive(true)
    })

    act(() => {
      result.current.setFindInput('hello')
    })

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.findTerm).toBe('hello')
    expect(result.current.totalMatches).toBe(0)
    expect(result.current.matches).toHaveLength(0)
  })

  it('whole word search', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    act(() => {
      result.current.setWholeWord(true)
    })

    act(() => {
      result.current.setFindInput('Hell')
    })

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.findTerm).toBe('Hell')
    expect(result.current.totalMatches).toBe(0)

    act(() => {
      result.current.setFindInput('Hello')
    })

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.findTerm).toBe('Hello')
    expect(result.current.totalMatches).toBe(2)
  })

  it('handleNext and handlePrev cycle through matches', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    act(() => {
      result.current.setFindInput('Hello')
    })

    act(() => {
      jest.advanceTimersByTime(800)
    })

    expect(result.current.matchIndex).toBe(0)

    act(() => {
      result.current.handleNext()
    })

    expect(result.current.matchIndex).toBe(1)

    act(() => {
      result.current.handlePrev()
    })

    expect(result.current.matchIndex).toBe(0)

    act(() => {
      result.current.handlePrev()
    })

    expect(result.current.matchIndex).toBe(1)

    act(() => {
      result.current.handleNext()
    })

    expect(result.current.matchIndex).toBe(0)
  })

  it('openFindReplaceModal opens the modal', () => {
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams }))

    expect(result.current.findReplaceOpen).toBe(false)

    act(() => {
      result.current.openFindReplaceModal()
    })

    expect(result.current.findReplaceOpen).toBe(true)
  })
})
