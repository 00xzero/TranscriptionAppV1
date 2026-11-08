import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Seg, Match, SegmentMatch } from '../types'
import { isUnicodeWordChar } from '../utils'
import type { TextEdit } from './useTranscriptMutations'

type SegmentMatches = { id: string; text: string; ranges: SegmentMatch[]; matches: Match[] }

/** Match against whole-string lowercase, but return ranges in the source. */
function findTextMatches(text: string, needle: string, caseSensitive: boolean, wholeWord: boolean) {
  const haystack = caseSensitive ? text : text.toLowerCase()
  const ranges: Pick<Match, 'index' | 'length'>[] = []
  if (!needle.length) return ranges

  // A lowercase expansion can shift every offset after it. Record the source
  // start for each folded UTF-16 unit, so partial hits cover its whole character.
  const sourceStarts: number[] = []
  if (haystack.length !== text.length) {
    let start = 0
    for (const char of text) {
      for (let i = 0; i < char.toLowerCase().length; i++) sourceStarts.push(start)
      start += char.length
    }
  }

  let sourceEnd = 0
  for (let start = 0; ; ) {
    const index = haystack.indexOf(needle, start)
    if (index < 0) break
    start = index + needle.length
    if (wholeWord && (isUnicodeWordChar(haystack[index - 1]) || isUnicodeWordChar(haystack[start]))) continue

    const from = sourceStarts[index] ?? index
    const last = sourceStarts[start - 1]
    const end = last === undefined ? start : last + (text.codePointAt(last)! > 0xffff ? 2 : 1)
    if (from < sourceEnd) continue
    ranges.push({ index: from, length: end - from })
    sourceEnd = end
  }
  return ranges
}

export function useTranscriptSearch({
  segments,
  scheduleSave,
  scheduleSaves,
  setEditingId,
  scrollToSegmentIndex,
  suspendFollow,
  closeSpeakerPopover,
  exportModalOpen,
  editingText = false,
  canReplace, recordReplace,
}: {
  segments: Seg[]
  scheduleSave: (segId: string, newText: string) => void
  scheduleSaves: (edits: readonly TextEdit[]) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  scrollToSegmentIndex: (idx: number, opts?: { smooth?: boolean }) => void
  suspendFollow: (reason?: 'search' | 'ui') => void
  closeSpeakerPopover: (reason?: 'dismiss' | 'outside' | 'selection' | 'external') => void
  exportModalOpen: boolean
  editingText?: boolean
  /** False while a split or undo is pending: replaced text would land on a changing shape. */
  canReplace: boolean
  recordReplace?: (edits: TextEdit[], selection?: { start: number; end: number }, all?: boolean) => void
}) {
  const [findInput, setFindInput] = useState('')
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  // The textarea owns the current keystroke. Refresh retained highlights in
  // a lower-priority render, and always use fresh text for the Find dialog.
  const deferHighlights = editingText && !findReplaceOpen && !!findTerm
  const deferredSegments = useDeferredValue(deferHighlights ? segments : null)
  const searchSegments = (deferHighlights && deferredSegments) || segments

  const openFindReplaceModal = useCallback(() => {
    if (exportModalOpen) return
    setEditingId(null)
    closeSpeakerPopover('external')
    setFindReplaceOpen(true)
    if (findTerm) {
      suspendFollow('search')
    }
  }, [closeSpeakerPopover, exportModalOpen, findTerm, setEditingId, suspendFollow])

  const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
  const collectMatches = useMemo(() => {
    let entries: SegmentMatches[] = []
    let positions = new Map<string, number>()
    return (rows: readonly Seg[]) => {
      const sameOrder = rows.length === entries.length && rows.every((row, index) => row.id === entries[index].id)
      const nextPositions = sameOrder ? positions : new Map<string, number>()
      const next: SegmentMatches[] = []
      let total = 0
      if (needle) {
        for (let index = 0; index < rows.length; index++) {
          const seg = rows[index]
          const previousIndex = sameOrder ? index : positions.get(seg.id)
          let entry = previousIndex === undefined ? undefined : entries[previousIndex]
          if (entry?.text !== seg.text) {
            const ranges = findTextMatches(seg.text, needle, caseSensitive, wholeWord)
            entry = {
              id: seg.id,
              text: seg.text,
              ranges: ranges.map((range, matchIdx) => ({ ...range, matchIdx })),
              matches: ranges.map((range) => ({ segId: seg.id, ...range })),
            }
          }
          next.push(entry)
          if (!sameOrder) nextPositions.set(seg.id, index)
          total += entry.matches.length
        }
      }
      entries = next
      positions = nextPositions
      // The closed dialog only needs the active match and the per-card ranges.
      let flattened: Match[] | undefined
      return {
        matchRangesFor: (id: string) => {
          const index = nextPositions.get(id)
          return index === undefined ? undefined : next[index].ranges
        },
        totalMatches: total,
        getMatches: () => flattened ??= next.flatMap((entry) => entry.matches),
        matchAt: (index: number) => {
          if (index < 0 || index >= total) return null
          for (const { matches } of next) {
            if (index < matches.length) return { match: matches[index], localIndex: index }
            index -= matches.length
          }
          return null
        },
      }
    }
  }, [needle, caseSensitive, wholeWord])
  const { getMatches, matchAt, matchRangesFor, totalMatches } =
    useMemo(() => collectMatches(searchSegments), [collectMatches, searchSegments])

  const currentIndex = Math.min(matchIndex, totalMatches - 1)
  const selection = matchAt(currentIndex)
  const currentMatch = selection?.match ?? null
  const currentLocalMatchIndex = selection?.localIndex ?? -1

  useEffect(() => {
    if (totalMatches === 0 && matchIndex > 0) {
      setMatchIndex(0)
      return
    }
    if (totalMatches > 0 && matchIndex >= totalMatches) {
      setMatchIndex(totalMatches - 1)
    }
  }, [totalMatches, matchIndex])

  useEffect(() => {
    setMatchIndex(0)
    if (findTerm) {
      suspendFollow('search')
    }
  }, [findTerm, caseSensitive, wholeWord, suspendFollow])

  const scrollToMatch = useCallback((match: Match) => {
    const index = segments.findIndex((segment) => segment.id === match.segId)
    if (index >= 0) scrollToSegmentIndex(index)
  }, [segments, scrollToSegmentIndex])

  useEffect(() => {
    if (findReplaceOpen && currentMatch) scrollToMatch(currentMatch)
  }, [currentMatch, findReplaceOpen, scrollToMatch])

  const jumpToMatch = useCallback((index: number) => {
    const match = matchAt(index)?.match
    if (!match) return
    setMatchIndex(index)
    scrollToMatch(match)
  }, [matchAt, scrollToMatch])

  const goToDelta = useCallback((delta: number) => {
    if (!totalMatches) return
    setMatchIndex((prev: number) => {
      if (prev < 0) return delta > 0 ? 0 : totalMatches - 1
      const next = (prev + delta + totalMatches) % totalMatches
      return next
    })
  }, [totalMatches])

  const handlePrev = useCallback(() => goToDelta(-1), [goToDelta])
  const handleNext = useCallback(() => goToDelta(1), [goToDelta])

  const handleReplace = useCallback(() => {
    if (!currentMatch || !canReplace) return
    const seg = segments.find((s: Seg) => s.id === currentMatch.segId)
    if (!seg) return
    const text = seg.text
    const before = text.slice(0, currentMatch.index)
    const after = text.slice(currentMatch.index + currentMatch.length)
    const updated = before + replaceTerm + after
    if (updated !== text) {
      recordReplace?.([{ segId: seg.id, before: text, after: updated }], { start: currentMatch.index, end: currentMatch.index + currentMatch.length })
      scheduleSave(seg.id, updated)
    }

    // The old ordinal no longer describes the result list. Recount only this
    // segment and advance from the end of the insertion in its new text.
    const first = currentIndex - currentLocalMatchIndex
    const pastSegment = first + (matchRangesFor(seg.id)?.length ?? 0)
    const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
    const remaining = findTextMatches(updated, needle, caseSensitive, wholeWord)
    const next = remaining.findIndex((range) => range.index >= currentMatch.index + replaceTerm.length)
    if (next >= 0) setMatchIndex(first + next)
    else if (pastSegment < totalMatches) setMatchIndex(first + remaining.length)
    else if (first > 0 || remaining.some((range) => range.index + range.length <= currentMatch.index)) setMatchIndex(0)
    // If only matches touching the insertion remain, let the user choose
    // one explicitly with Next/Previous rather than replacing it again.
    else setMatchIndex(-1)
  }, [currentMatch, canReplace, segments, replaceTerm, scheduleSave, recordReplace,
    currentIndex, currentLocalMatchIndex, matchRangesFor, totalMatches, caseSensitive, findTerm, wholeWord])

  const handleReplaceAll = useCallback(() => {
    if (!totalMatches || !canReplace) return
    const edits: TextEdit[] = []
    for (const segment of segments) {
      const ranges = matchRangesFor(segment.id)
      if (!ranges?.length) continue
      const before = segment.text
      const pieces: string[] = []
      let end = 0
      for (const range of ranges) {
        pieces.push(before.slice(end, range.index), replaceTerm)
        end = range.index + range.length
      }
      pieces.push(before.slice(end))
      const after = pieces.join('')
      if (after !== before) edits.push({ segId: segment.id, before, after })
    }
    if (!edits.length) return
    recordReplace?.(edits, undefined, true)
    scheduleSaves(edits)
  }, [totalMatches, canReplace, matchRangesFor, segments, replaceTerm, scheduleSaves, recordReplace])

  // Debounce findInput into findTerm
  useEffect(() => {
    if (!findInput.trim()) {
      setFindTerm('')
      return
    }
    const timer = setTimeout(() => {
      setFindTerm(findInput)
    }, 800)
    return () => clearTimeout(timer)
  }, [findInput])

  const onFindKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (findInput !== findTerm) {
      setFindTerm(findInput)
      return
    }
    if (totalMatches > 0) {
      setFindReplaceOpen(false)
    }
  }, [findInput, findTerm, totalMatches])

  const hasMatches = totalMatches > 0
  const isFindDirty = findInput !== findTerm
  const canNavigate = hasMatches && !isFindDirty
  const matchSummary = isFindDirty
    ? 'Searching...'
    : totalMatches
      ? (matchIndex < 0 ? `${totalMatches} matches` : `${Math.min(matchIndex + 1, totalMatches)} of ${totalMatches} matches`)
      : (findTerm ? '0 matches' : '')

  const clearSearch = useCallback(() => {
    setFindInput('')
    setReplaceTerm('')
    setMatchIndex(0)
    setCaseSensitive(false)
    setWholeWord(false)
  }, [])

  return {
    findInput, setFindInput,
    findTerm,
    replaceTerm, setReplaceTerm,
    matchIndex, jumpToMatch,
    caseSensitive, setCaseSensitive,
    wholeWord, setWholeWord,
    findReplaceOpen, setFindReplaceOpen,
    clearSearch,
    getMatches,
    matchRangesFor,
    totalMatches,
    currentMatch,
    currentLocalMatchIndex,
    isFindDirty,
    canNavigate,
    matchSummary,
    handlePrev,
    handleNext,
    handleReplace,
    handleReplaceAll,
    onFindKeyDown,
    openFindReplaceModal,
  }
}
