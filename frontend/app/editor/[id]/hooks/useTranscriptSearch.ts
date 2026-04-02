import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Seg, Match, SegmentMatch } from '../types'
import { isUnicodeWordChar } from '../utils'

export function useTranscriptSearch({
  segments,
  source,
  editingTexts,
  setEditingTexts,
  scheduleSave,
  setEditingId,
  scrollToSegmentIndex,
  suspendFollow,
  closeSpeakerPopover,
  exportModalOpen,
}: {
  segments: Seg[]
  source: 'chunks' | 'segments'
  editingTexts: Record<string, string>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  scheduleSave: (segId: string, newText: string) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  scrollToSegmentIndex: (idx: number, opts?: { smooth?: boolean }) => void
  suspendFollow: (reason?: 'search' | 'ui') => void
  closeSpeakerPopover: (reason?: 'dismiss' | 'outside' | 'selection' | 'external') => void
  exportModalOpen: boolean
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
    if (!needle.length) return []
    const found: Match[] = []
    for (const seg of segments) {
      const text = editingTexts[seg.id] ?? seg.text ?? ''
      const haystack = caseSensitive ? text : text.toLowerCase()
      let start = 0
      while (true) {
        const idx = haystack.indexOf(needle, start)
        if (idx === -1) break
        if (wholeWord) {
          const before = idx > 0 ? haystack[idx - 1] : ''
          const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : ''
          if ((before && isUnicodeWordChar(before)) || (after && isUnicodeWordChar(after))) {
            start = idx + Math.max(needle.length, 1)
            continue
          }
        }
        found.push({ segId: seg.id, index: idx, length: needle.length })
        start = idx + Math.max(needle.length, 1)
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
  const currentMatch = totalMatches ? matches[Math.min(matchIndex, totalMatches - 1)] : null

  useEffect(() => {
    if (totalMatches === 0 && matchIndex !== 0) {
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
      const next = (prev + delta + totalMatches) % totalMatches
      return next
    })
  }, [totalMatches])

  const handlePrev = useCallback(() => goToDelta(-1), [goToDelta])
  const handleNext = useCallback(() => goToDelta(1), [goToDelta])

  const handleReplace = useCallback(() => {
    if (!currentMatch) return
    const seg = segments.find((s: Seg) => s.id === currentMatch.segId)
    if (!seg) return
    const text = editingTexts[seg.id] ?? seg.text ?? ''
    const before = text.slice(0, currentMatch.index)
    const after = text.slice(currentMatch.index + currentMatch.length)
    const updated = before + replaceTerm + after
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, [seg.id]: updated }))
    scheduleSave(seg.id, updated)
    handleNext()
  }, [currentMatch, segments, editingTexts, replaceTerm, scheduleSave, handleNext, setEditingTexts])

  const handleReplaceAll = useCallback(() => {
    if (!totalMatches) return
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
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, ...updatedTexts }))
    Object.entries(updatedTexts).forEach(([segId, text]) => scheduleSave(segId, text))
  }, [totalMatches, matches, segments, editingTexts, replaceTerm, scheduleSave, setEditingTexts])

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
      ? `${matchIndex + 1} of ${totalMatches} matches`
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
    hasMatches,
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
