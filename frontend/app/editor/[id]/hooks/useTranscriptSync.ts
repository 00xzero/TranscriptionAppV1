import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtuosoHandle, ListRange } from 'react-virtuoso'
import type { Seg } from '../types'
import {
  SYNC_OFFSET_MS, SEEK_LOCK_MS, PROGRAMMATIC_SCROLL_RESET_MS,
  ACTIVE_CARD_VISIBILITY_MARGIN_PX,
} from '../utils'
import { useUserScrollDetection } from './useUserScrollDetection'

export function useTranscriptSync({
  segments,
  editingId,
  speakerPopover,
}: {
  segments: Seg[]
  editingId: string | null
  speakerPopover: unknown
}) {
  const [syncDirection, setSyncDirection] = useState<'up' | 'down'>('down')
  const [isFollowMode, setIsFollowMode] = useState(true)
  const [hasUserScrolled, setHasUserScrolled] = useState(false)
  const [activeIds, setActiveIds] = useState<{ segId?: string; wordKey?: string }>({})
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const [waveformCollapsed, setWaveformCollapsed] = useState(false)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const segmentsRef = useRef(segments)
  const isUserScrollingRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const programmaticScrollResetTimerRef = useRef<number | null>(null)
  const isScrubbingRef = useRef(false)
  const clickLockRef = useRef<number | null>(null)

  useEffect(() => { segmentsRef.current = segments }, [segments])

  const scrollContainerRef = useCallback((el: HTMLDivElement | null) => {
    transcriptScrollRef.current = el
    setScrollParent(el)
  }, [])

  const setSeekLock = useCallback(() => {
    clickLockRef.current = Date.now() + SEEK_LOCK_MS
  }, [])

  const clearSeekLock = useCallback(() => {
    clickLockRef.current = null
  }, [])

  const findActiveSegmentId = useCallback((tMs: number) => {
    if (segmentsRef.current.length === 0) return undefined
    const tAdj = Math.max(0, tMs - SYNC_OFFSET_MS)
    for (const seg of segmentsRef.current) {
      if (seg.start_ms > tAdj) break
      if (tAdj <= seg.end_ms) return seg.id
    }
    return undefined
  }, [])

  const syncActiveSegment = useCallback((tMs: number) => {
    if (segmentsRef.current.length === 0) return undefined
    if (clickLockRef.current && Date.now() < clickLockRef.current) {
      return undefined
    }
    const segId = findActiveSegmentId(tMs)
    if (segId) {
      setActiveIds((prev) => {
        if (prev.segId === segId && prev.wordKey === undefined) return prev
        return { segId, wordKey: undefined }
      })
    }
    return segId
  }, [findActiveSegmentId])

  const markProgrammaticScroll = useCallback(() => {
    isUserScrollingRef.current = false
    isProgrammaticScrollRef.current = true
    if (programmaticScrollResetTimerRef.current) {
      window.clearTimeout(programmaticScrollResetTimerRef.current)
    }
    programmaticScrollResetTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
      programmaticScrollResetTimerRef.current = null
    }, PROGRAMMATIC_SCROLL_RESET_MS)
  }, [])

  const scrollTranscriptToTop = useCallback((behavior: ScrollBehavior) => {
    markProgrammaticScroll()
    transcriptScrollRef.current?.scrollTo({ top: 0, behavior })
  }, [markProgrammaticScroll])

  const handleReturnToTop = useCallback(() => {
    setIsFollowMode(false)
    setWaveformCollapsed(false)
    scrollTranscriptToTop('auto')
  }, [scrollTranscriptToTop])

  const scrollToSegmentIndex = useCallback((idx: number, { smooth = false }: { smooth?: boolean } = {}) => {
    const range = visibleRangeRef.current
    const buffer = 10
    const isNearby = idx >= range.startIndex - buffer && idx <= range.endIndex + buffer
    markProgrammaticScroll()
    virtuosoRef.current?.scrollToIndex({
      index: idx,
      align: 'center',
      behavior: smooth && isNearby ? 'smooth' : 'auto',
    })
  }, [markProgrammaticScroll])

  const isActiveSegmentSafelyVisible = useCallback((segId: string) => {
    const container = transcriptScrollRef.current
    if (!container) return false
    const card = container.querySelector<HTMLElement>(`[data-segment-id="${segId}"]`)
    if (!card) return false
    const containerRect = container.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const topBound = containerRect.top + ACTIVE_CARD_VISIBILITY_MARGIN_PX
    const bottomBound = containerRect.bottom - ACTIVE_CARD_VISIBILITY_MARGIN_PX
    return cardRect.top >= topBound && cardRect.bottom <= bottomBound
  }, [])

  const ensureActiveSegmentVisible = useCallback((segId: string) => {
    const idx = segmentsRef.current.findIndex((s) => s.id === segId)
    if (idx < 0) return
    if (isActiveSegmentSafelyVisible(segId)) return
    isUserScrollingRef.current = false
    scrollToSegmentIndex(idx, { smooth: false })
  }, [isActiveSegmentSafelyVisible, scrollToSegmentIndex])

  const centerActiveSegment = useCallback((segId: string) => {
    const idx = segmentsRef.current.findIndex((s) => s.id === segId)
    if (idx < 0) return
    isUserScrollingRef.current = false
    scrollToSegmentIndex(idx, { smooth: true })
  }, [scrollToSegmentIndex])

  const handleRangeChanged = useCallback((range: ListRange) => {
    visibleRangeRef.current = range
    if (!activeIds.segId) return
    const activeIdx = segments.findIndex(s => s.id === activeIds.segId)
    if (activeIdx < 0) return
    if (activeIdx < range.startIndex) setSyncDirection('up')
    else if (activeIdx > range.endIndex) setSyncDirection('down')
  }, [segments, activeIds.segId])

  useEffect(() => {
    if (!activeIds.segId) return
    const activeIdx = segments.findIndex(s => s.id === activeIds.segId)
    if (activeIdx < 0) return
    const range = visibleRangeRef.current
    if (activeIdx < range.startIndex) setSyncDirection('up')
    else if (activeIdx > range.endIndex) setSyncDirection('down')
  }, [activeIds.segId, segments])

  // Auto-scroll to active segment when in follow mode
  useEffect(() => {
    if (!isFollowMode || !activeIds.segId) return
    if (isScrubbingRef.current) {
      ensureActiveSegmentVisible(activeIds.segId)
      return
    }
    centerActiveSegment(activeIds.segId)
  }, [activeIds.segId, centerActiveSegment, ensureActiveSegmentVisible, isFollowMode])

  // Turn off follow mode when user starts editing or speaker popover opens
  useEffect(() => {
    if (editingId || speakerPopover) setIsFollowMode(false)
  }, [editingId, speakerPopover])

  // Collapse waveform when transcript scrolls past 50px
  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) return
    const handleScroll = () => {
      if (isScrubbingRef.current) return
      setWaveformCollapsed(container.scrollTop > 50)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useUserScrollDetection({
    containerRef: transcriptScrollRef,
    isUserScrollingRef,
    isProgrammaticScrollRef: isProgrammaticScrollRef,
    programmaticScrollResetTimerRef,
    setIsFollowMode,
    setHasUserScrolled,
    speakerPopover,
  })

  const resumeFollow = useCallback(() => {
    isUserScrollingRef.current = false
    setIsFollowMode(true)
    setHasUserScrolled(false)
    const segId = activeIds.segId
    if (segId) {
      const idx = segmentsRef.current.findIndex(s => s.id === segId)
      if (idx >= 0) scrollToSegmentIndex(idx)
    } else {
      scrollTranscriptToTop('auto')
    }
  }, [activeIds.segId, scrollToSegmentIndex, scrollTranscriptToTop])

  return {
    syncDirection,
    isFollowMode, setIsFollowMode,
    hasUserScrolled,
    activeIds, setActiveIds,
    resumeFollow,
    scrollParent,
    waveformCollapsed, setWaveformCollapsed,
    virtuosoRef,
    transcriptScrollRef,
    scrollContainerRef,
    isScrubbingRef,
    findActiveSegmentId,
    syncActiveSegment,
    handleRangeChanged,
    scrollToSegmentIndex,
    ensureActiveSegmentVisible,
    handleReturnToTop,
    setSeekLock,
    clearSeekLock,
  }
}
