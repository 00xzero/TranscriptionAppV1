import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Seg, Match, SegmentMatch } from '../types'
import { isUnicodeWordChar } from '../utils'
import type { TextEdit } from './useTranscriptMutations'

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
  editingTexts,
  setEditingTexts,
  scheduleSave,
  setEditingId,
  scrollToSegmentIndex,
  suspendFollow,
  closeSpeakerPopover,
  exportModalOpen,
  canReplace, recordReplace,
}: {
  segments: Seg[]
  editingTexts: Record<string, string>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  scheduleSave: (segId: string, newText: string) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  scrollToSegmentIndex: (idx: number, opts?: { smooth?: boolean }) => void
  suspendFollow: (reason?: 'search' | 'ui') => void
  closeSpeakerPopover: (reason?: 'dismiss' | 'outside' | 'selection' | 'external') => void
  exportModalOpen: boolean
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

  const openFindReplaceModal = useCallback(() => {
    if (exportModalOpen) return
    setEditingId(null)
    closeSpeakerPopover('external')
    setFindReplaceOpen(true)
    if (findTerm) {
      suspendFollow('search')
    }
  }, [closeSpeakerPopover, exportModalOpen, findTerm, setEditingId, suspendFollow])

  const matches = useMemo<Match[]>(() => {
    if (!findTerm) return []
    const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
    const found: Match[] = []
    for (const seg of segments) {
      const text = editingTexts[seg.id] ?? seg.text ?? ''
      for (const range of findTextMatches(text, needle, caseSensitive, wholeWord)) {
        found.push({ segId: seg.id, ...range })
      }
    }
    return found
  }, [segments, editingTexts, findTerm, caseSensitive, wholeWord])

  const matchesBySeg = useMemo(() => {
    const map = new Map<string, SegmentMatch[]>()
    matches.forEach((match: Match, idx: number) => {
      const arr = map.get(match.segId) ?? []
      arr.push({ index: match.index, length: match.length, matchIdx: idx })
      map.set(match.segId, arr)
    })
    return map
  }, [matches])

  const totalMatches = matches.length
  const currentMatch = totalMatches && matchIndex >= 0 ? matches[Math.min(matchIndex, totalMatches - 1)] : null

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

  useEffect(() => {
    if (!findReplaceOpen) return
    if (!currentMatch) return
    const idx = segments.findIndex((s: Seg) => s.id === currentMatch.segId)
    if (idx >= 0) {
      scrollToSegmentIndex(idx)
    }
  }, [currentMatch, findReplaceOpen, segments, scrollToSegmentIndex])

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
    const text = editingTexts[seg.id] ?? seg.text ?? ''
    const before = text.slice(0, currentMatch.index)
    const after = text.slice(currentMatch.index + currentMatch.length)
    const updated = before + replaceTerm + after
    if (updated !== text) {
      recordReplace?.([{ segId: seg.id, before: text, after: updated }], { start: currentMatch.index, end: currentMatch.index + currentMatch.length })
      setEditingTexts((prev) => ({ ...prev, [seg.id]: updated }))
      scheduleSave(seg.id, updated)
    }

    // The old ordinal no longer describes the result list. Recount only this
    // segment and advance from the end of the insertion in its new text.
    const first = matches.findIndex((match) => match.segId === seg.id)
    const pastSegment = first + (matchesBySeg.get(seg.id)?.length ?? 0)
    const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
    const remaining = findTextMatches(updated, needle, caseSensitive, wholeWord)
    const next = remaining.findIndex((range) => range.index >= currentMatch.index + replaceTerm.length)
    if (next >= 0) setMatchIndex(first + next)
    else if (pastSegment < totalMatches) setMatchIndex(first + remaining.length)
    else if (first > 0 || remaining.some((range) => range.index + range.length <= currentMatch.index)) setMatchIndex(0)
    // If only matches touching the insertion remain, let the user choose
    // one explicitly with Next/Previous rather than replacing it again.
    else setMatchIndex(-1)
  }, [currentMatch, canReplace, segments, editingTexts, replaceTerm, scheduleSave, setEditingTexts, recordReplace,
    matches, matchesBySeg, totalMatches, caseSensitive, findTerm, wholeWord])

  const handleReplaceAll = useCallback(() => {
    if (!totalMatches || !canReplace) return
    const baseTexts: Record<string, string> = {}
    segments.forEach((seg: Seg) => {
      baseTexts[seg.id] = editingTexts[seg.id] ?? seg.text ?? ''
    })
    const shifts: Record<string, number> = {}
    const updatedTexts: Record<string, string> = {}

    matches.forEach((match: Match) => {
      const segId = match.segId
      const prior = updatedTexts[segId] ?? baseTexts[segId]
      const shift = shifts[segId] ?? 0
      const idx = match.index + shift
      const before = prior.slice(0, idx)
      const after = prior.slice(idx + match.length)
      const updated = before + replaceTerm + after
      updatedTexts[segId] = updated
      shifts[segId] = shift + replaceTerm.length - match.length
    })

    if (Object.keys(updatedTexts).length === 0) return
    recordReplace?.(Object.entries(updatedTexts).map(([segId, after]) => ({ segId, before: baseTexts[segId], after })), undefined, true)
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, ...updatedTexts }))
    Object.entries(updatedTexts).forEach(([segId, text]) => scheduleSave(segId, text))
  }, [totalMatches, canReplace, matches, segments, editingTexts, replaceTerm, scheduleSave, setEditingTexts, recordReplace])

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
    matchIndex, setMatchIndex,
    caseSensitive, setCaseSensitive,
    wholeWord, setWholeWord,
    findReplaceOpen, setFindReplaceOpen,
    clearSearch,
    matches,
    matchesBySeg,
    totalMatches,
    currentMatch,
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
