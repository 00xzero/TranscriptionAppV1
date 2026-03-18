import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtuosoHandle, ListRange } from 'react-virtuoso'
import type { Seg } from '../types'
import {
  SYNC_OFFSET_MS,
  ACTIVE_CARD_VISIBILITY_MARGIN_PX,
} from '../utils'
import { useScrollSyncMachine } from './useScrollSyncMachine'
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
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const [waveformCollapsed, setWaveformCollapsed] = useState(false)

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const visibleRangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const segmentsRef = useRef(segments)
  const prevEditingBlockedRef = useRef<boolean>(false)
  const prevPopoverBlockedRef = useRef<boolean>(false)

  useEffect(() => { segmentsRef.current = segments }, [segments])

  const scrollContainerRef = useCallback((el: HTMLDivElement | null) => {
    transcriptScrollRef.current = el
    setScrollParent(el)
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

  const scrollToSegmentIndexImpl = useCallback((idx: number, { smooth = false }: { smooth?: boolean } = {}) => {
    const range = visibleRangeRef.current
    const buffer = 10
    const isNearby = idx >= range.startIndex - buffer && idx <= range.endIndex + buffer
    virtuosoRef.current?.scrollToIndex({
      index: idx,
      align: 'center',
      behavior: smooth && isNearby ? 'smooth' : 'auto',
    })
  }, [])

  const isActiveSegmentSafelyVisible = useCallback((segId?: string) => {
    if (!segId) return false
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

  const ensureActiveSegmentVisible = useCallback((segId?: string) => {
    if (!segId) return
    const idx = segmentsRef.current.findIndex((s) => s.id === segId)
    if (idx < 0) return
    if (isActiveSegmentSafelyVisible(segId)) return
    scrollToSegmentIndexImpl(idx, { smooth: false })
  }, [isActiveSegmentSafelyVisible, scrollToSegmentIndexImpl])

  const centerActiveSegment = useCallback((segId?: string, behavior: ScrollBehavior = 'smooth') => {
    if (!segId) return
    const idx = segmentsRef.current.findIndex((s) => s.id === segId)
    if (idx < 0) return
    scrollToSegmentIndexImpl(idx, { smooth: behavior === 'smooth' })
  }, [scrollToSegmentIndexImpl])

  const machine = useScrollSyncMachine({
    onScrollToActive: (state, behavior) => centerActiveSegment(state.activeSegId, behavior),
    onEnsureActiveVisible: (state) => ensureActiveSegmentVisible(state.activeSegId),
    onScrollToTop: (_state, behavior) => {
      transcriptScrollRef.current?.scrollTo({ top: 0, behavior })
    },
  })
  const {
    state: machineState,
    stateRef: machineStateRef,
    flags,
    send: sendMachine,
    markProgrammaticScroll,
    isProgrammaticScrollActive,
    resumeFollow,
    suspendFollow,
    startSeek,
    previewSeek: previewMachineSeek,
    commitSeek: commitMachineSeek,
    onWordSeek: markWordSeek,
    onSegmentSeek: markSegmentSeek,
    handleReturnToTop: returnToTop,
  } = machine

  const activeIds = {
    segId: machineState.activeSegId,
    wordKey: undefined,
  }

  const scrollToSegmentIndex = useCallback((idx: number, opts?: { smooth?: boolean }) => {
    markProgrammaticScroll()
    scrollToSegmentIndexImpl(idx, opts)
  }, [markProgrammaticScroll, scrollToSegmentIndexImpl])

  const handleRangeChanged = useCallback((range: ListRange) => {
    visibleRangeRef.current = range
    if (!machineState.activeSegId) return
    const activeIdx = segments.findIndex(s => s.id === machineState.activeSegId)
    if (activeIdx < 0) return
    if (activeIdx < range.startIndex) setSyncDirection('up')
    else if (activeIdx > range.endIndex) setSyncDirection('down')
  }, [segments, machineState.activeSegId])

  useEffect(() => {
    if (!machineState.activeSegId) return
    const activeIdx = segments.findIndex(s => s.id === machineState.activeSegId)
    if (activeIdx < 0) return
    const range = visibleRangeRef.current
    if (activeIdx < range.startIndex) setSyncDirection('up')
    else if (activeIdx > range.endIndex) setSyncDirection('down')
  }, [machineState.activeSegId, segments])

  // Collapse waveform when transcript scrolls past 50px
  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) return
    const handleScroll = () => {
      if (machineStateRef.current.mode === 'seeking') return
      setWaveformCollapsed(container.scrollTop > 50)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [machineStateRef])

  useEffect(() => {
    const isBlocked = !!editingId
    if (prevEditingBlockedRef.current === isBlocked) return
    prevEditingBlockedRef.current = isBlocked
    sendMachine({ type: isBlocked ? 'EDIT_BLOCKED' : 'EDIT_UNBLOCKED', now: Date.now() })
  }, [editingId, sendMachine])

  useEffect(() => {
    const isBlocked = !!speakerPopover
    if (prevPopoverBlockedRef.current === isBlocked) return
    prevPopoverBlockedRef.current = isBlocked
    sendMachine({ type: isBlocked ? 'POPOVER_BLOCKED' : 'POPOVER_UNBLOCKED', now: Date.now() })
  }, [speakerPopover, sendMachine])

  useUserScrollDetection({
    containerRef: transcriptScrollRef,
    disabled: !!speakerPopover,
    isProgrammaticScrollActive,
    onUserScroll: () => sendMachine({ type: 'USER_SCROLL', now: Date.now() }),
  })

  const onAudioTick = useCallback((tMs: number) => {
    const segId = findActiveSegmentId(tMs)
    sendMachine({ type: 'AUDIO_TICK', now: Date.now(), segId })
    return segId
  }, [findActiveSegmentId, sendMachine])

  const previewSeek = useCallback((tMs: number) => {
    const segId = findActiveSegmentId(tMs)
    previewMachineSeek(segId)
    return segId
  }, [findActiveSegmentId, previewMachineSeek])

  const commitSeek = useCallback((tMs: number, opts?: { lockSeek?: boolean }) => {
    const segId = findActiveSegmentId(tMs)
    const nextState = commitMachineSeek(segId, opts)
    return segId ?? nextState.activeSegId
  }, [commitMachineSeek, findActiveSegmentId])

  const onWordSeek = useCallback((segId: string) => {
    markWordSeek(segId)
  }, [markWordSeek])

  const onSegmentSeek = markSegmentSeek

  const handleReturnToTop = useCallback(() => {
    setWaveformCollapsed(false)
    returnToTop()
  }, [returnToTop])

  return {
    mode: machineState.mode,
    syncDirection,
    isFollowMode: flags.isFollowMode,
    hasUserScrolled: machineState.hasUserScrolled,
    activeIds,
    resumeFollow,
    suspendFollow,
    scrollParent,
    waveformCollapsed, setWaveformCollapsed,
    virtuosoRef,
    transcriptScrollRef,
    scrollContainerRef,
    findActiveSegmentId,
    handleRangeChanged,
    scrollToSegmentIndex,
    handleReturnToTop,
    onAudioTick,
    startSeek,
    previewSeek,
    commitSeek,
    onWordSeek,
    onSegmentSeek,
  }
}
