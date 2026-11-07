import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useTranscriptSearch } from '../../app/(app)/editor/[id]/hooks/useTranscriptSearch'
import type { Seg } from '../../app/(app)/editor/[id]/types'

const defaultParams = {
  segments: [
    { id: 's1', start_ms: 0, end_ms: 1000, text: 'Hello world', speaker_id: 'sp1' },
    { id: 's2', start_ms: 1000, end_ms: 2000, text: 'Hello again', speaker_id: 'sp1' },
  ] as Seg[],
  editingTexts: {},
  setEditingTexts: jest.fn(),
  scheduleSave: jest.fn(),
  scheduleSaves: jest.fn(),
  setEditingId: jest.fn(),
  scrollToSegmentIndex: jest.fn(),
  suspendFollow: jest.fn(),
  setSpeakerPopover: jest.fn(),
  closeSpeakerPopover: jest.fn(),
  exportModalOpen: false,
  canReplace: true,
}

describe('useTranscriptSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    defaultParams.setEditingTexts.mockClear()
    defaultParams.scheduleSave.mockClear()
    defaultParams.scheduleSaves.mockClear()
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

  it.each([
    ['İstanbul the end', 'the', 9, 3, 'İstanbul X end'],
    ['İstanbul', 'i', 0, 1, 'Xstanbul'],
    ['İstanbul', 'i\u0307', 0, 1, 'Xstanbul'],
    ['İ 𐐀', '𐐨', 2, 2, 'İ X'],
    ['ΛΟΓΟΣ', 'λογος', 0, 5, 'X'],
    ['İİİ', '\u0307i', 0, 2, 'Xİ'],
  ])('uses source ranges for %s with %s', (text, query, index, length, replaced) => {
    const { result } = renderHook(() => useTranscriptSearch({
      ...defaultParams, segments: [{ ...defaultParams.segments[0], text }],
    }))
    act(() => { result.current.setFindInput(query); result.current.setReplaceTerm('X') })
    act(() => { jest.advanceTimersByTime(800) })
    expect(result.current.matches).toEqual([{ segId: 's1', index, length }])
    act(() => { result.current.handleReplaceAll() })
    expect(defaultParams.scheduleSaves).toHaveBeenCalledWith([{ segId: 's1', before: text, after: replaced }])
  })

  function setupReplace(texts: string[], replacement: string) {
    const segments = texts.map((text, i) => ({ ...defaultParams.segments[0], id: `s${i}`, text }))
    const hook = renderHook(() => {
      const [editingTexts, setEditingTexts] = useState<Record<string, string>>({})
      return useTranscriptSearch({ ...defaultParams, segments, editingTexts, setEditingTexts })
    })
    act(() => { hook.result.current.setFindInput('the'); hook.result.current.setReplaceTerm(replacement) })
    act(() => { jest.advanceTimersByTime(800) })
    return hook.result
  }

  it('repeated Replace advances through adjacent matches and the next segment', () => {
    const result = setupReplace(['thethe', 'the'], '')
    act(() => { result.current.handleReplace() })
    expect(result.current.currentMatch).toMatchObject({ segId: 's0', index: 0 })
    act(() => { result.current.handleReplace() })
    expect(result.current.currentMatch).toMatchObject({ segId: 's1' })
    act(() => { result.current.handleReplace() })
    expect(result.current.totalMatches).toBe(0)
    expect(defaultParams.scheduleSave.mock.calls).toEqual([['s0', 'the'], ['s0', ''], ['s1', '']])
  })

  it('skips inserted matches and allows explicit navigation after the last replacement', () => {
    const result = setupReplace(['the'], 'the the')
    act(() => { result.current.handleReplace() })
    expect(result.current.totalMatches).toBe(2)
    expect(result.current.currentMatch).toBeNull()
    act(() => { result.current.handleReplace() })
    expect(defaultParams.scheduleSave).toHaveBeenCalledTimes(1)
    act(() => { result.current.handlePrev() })
    expect(result.current.currentMatch?.index).toBe(4)
  })

  it('wraps to an earlier match and does not save an unchanged replacement', () => {
    const result = setupReplace(['the the'], 'the')
    act(() => { result.current.handlePrev() })
    act(() => { result.current.handleReplace() })
    expect(result.current.currentMatch?.index).toBe(0)
    expect(defaultParams.scheduleSave).not.toHaveBeenCalled()
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

  it('does not replace while a split or undo is pending', () => {
    const scheduleSave = jest.fn()
    const { result } = renderHook(() => useTranscriptSearch({ ...defaultParams, scheduleSave, canReplace: false }))

    act(() => {
      result.current.setFindInput('Hello')
      result.current.setReplaceTerm('Hi')
    })
    act(() => {
      jest.advanceTimersByTime(800)
    })
    expect(result.current.totalMatches).toBe(2)

    act(() => {
      result.current.handleReplace()
      result.current.handleReplaceAll()
    })
    expect(scheduleSave).not.toHaveBeenCalled()
  })
})
