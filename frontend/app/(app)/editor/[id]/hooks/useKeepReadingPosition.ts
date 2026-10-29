import { useCallback, useLayoutEffect, useRef } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { Seg } from '../types'

type ReadingAnchor = { segmentId: string; delta: number }

/** Drift smaller than this is rounding, not a lost place. */
const DRIFT_TOLERANCE_PX = 2
/** Frames in a row without drift before the layout counts as settled. */
const SETTLED_FRAMES = 8
/** The shortest hold: longer than the sidebar's 100ms width transition, which may start a frame late. */
const MIN_HOLD_MS = 200
/** The longest the anchor is held, whatever Virtuoso is still doing. */
const MAX_HOLD_MS = 1000
/**
 * Input anywhere on the page means the reader has moved on, and holding the old
 * place would fight them: a scroll, a jump from the speakers sidebar, a find
 * result, a seek from the player.
 */
const READER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/**
 * Keeps the reader on the same line when a layout change rewraps the
 * transcript, such as the speakers sidebar narrowing it.
 *
 * The anchor is a card actually on screen: the active one if visible, else the
 * first whose bottom is below the container's top. Virtuoso's own range would
 * not do, because it includes the overscan, so its first index can be far
 * above the viewport.
 *
 * The card is put back at its old distance from the top as the change commits,
 * then held there while the layout settles. Two things keep moving it, and
 * each is corrected before the browser paints it rather than a frame later:
 * an animated width rewraps the rows on every frame (a ResizeObserver on the
 * container sees each step after layout), and Virtuoso applies its
 * re-measurements by changing its list's padding and rows (a MutationObserver
 * on the list sees those). The hold ends once nothing has moved for a few
 * frames, after a second, as soon as the reader scrolls, clicks or types
 * anywhere, or when code navigating on purpose calls `releaseReadingPosition`.
 */
export function useKeepReadingPosition({ scrollRef, virtuosoRef, segments, activeSegId, markProgrammaticScroll }: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  segments: Seg[]
  activeSegId: string | undefined
  markProgrammaticScroll: () => void
}) {
  const pendingRef = useRef<ReadingAnchor | null>(null)
  const stopHoldRef = useRef<(() => void) | null>(null)
  const segmentsRef = useRef(segments)
  useLayoutEffect(() => { segmentsRef.current = segments }, [segments])

  const capture = useCallback((): ReadingAnchor | null => {
    const container = scrollRef.current
    // At the top there is no place to lose, and the header above the list moves nothing.
    if (!container || container.scrollTop === 0) return null
    const box = container.getBoundingClientRect()
    const cards = [...container.querySelectorAll<HTMLElement>('[data-segment-id]')]
    const onScreen = (rect: DOMRect) => rect.bottom > box.top && rect.top < box.bottom
    const card = cards.find((candidate) => candidate.dataset.segmentId === activeSegId && onScreen(candidate.getBoundingClientRect()))
      ?? cards.find((candidate) => candidate.getBoundingClientRect().bottom > box.top)
    if (!card?.dataset.segmentId) return null
    return { segmentId: card.dataset.segmentId, delta: card.getBoundingClientRect().top - box.top }
  }, [scrollRef, activeSegId])

  /** Runs `change` (a state update) and keeps the reader's place across the render it causes. */
  const keepReadingPosition = useCallback((change: () => void) => {
    pendingRef.current = capture()
    change()
  }, [capture])

  /** Ends any hold at once. Call it before navigating on purpose, or the hold scrolls back. */
  const releaseReadingPosition = useCallback(() => {
    pendingRef.current = null
    stopHoldRef.current?.()
  }, [])

  // No dependencies: it checks after every commit, and does work only after keepReadingPosition.
  useLayoutEffect(() => {
    const anchor = pendingRef.current
    pendingRef.current = null
    const container = scrollRef.current
    if (!anchor || !container) return

    let placedByIndex = false
    let holding = true
    /** Puts the card back; returns whether it was already in place. */
    const restore = (): boolean => {
      if (!holding) return true
      const card = container.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(anchor.segmentId)}"]`)
      if (card) {
        const drift = card.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.delta
        if (Math.abs(drift) <= DRIFT_TOLERANCE_PX) return true
        markProgrammaticScroll()
        container.scrollTop += drift
        return false
      }
      // Rewrapping pushed the card out of the rendered window: let Virtuoso place
      // it, once. A card `delta` px below the top is restored with a negative offset.
      if (placedByIndex) return false
      const index = segmentsRef.current.findIndex((segment) => segment.id === anchor.segmentId)
      if (index < 0) return true
      placedByIndex = true
      markProgrammaticScroll()
      virtuosoRef.current?.scrollToIndex({ index, align: 'start', offset: -anchor.delta })
      return false
    }

    stopHoldRef.current?.()
    restore()

    // Held through a ref, not an effect cleanup: playback re-renders the editor
    // many times a second, and a cleanup would end the hold on the next tick.
    const startedAt = performance.now()
    let settledFrames = 0
    let frame = 0
    const list = container.querySelector('[data-testid="virtuoso-item-list"]')
    const listChanges = new MutationObserver(() => { restore() })
    const resizes = new ResizeObserver(() => { restore() })
    const page = container.ownerDocument
    const stop = () => {
      holding = false
      cancelAnimationFrame(frame)
      listChanges.disconnect()
      resizes.disconnect()
      for (const type of READER_INPUT) page.removeEventListener(type, stop, { capture: true })
      if (stopHoldRef.current === stop) stopHoldRef.current = null
    }
    const hold = () => {
      settledFrames = restore() ? settledFrames + 1 : 0
      const held = performance.now() - startedAt
      if ((settledFrames >= SETTLED_FRAMES && held >= MIN_HOLD_MS) || held > MAX_HOLD_MS) stop()
      else frame = requestAnimationFrame(hold)
    }
    if (list) listChanges.observe(list, { attributes: true, attributeFilter: ['style'], childList: true })
    resizes.observe(container)
    // On the document, in the capture phase: input in the sidebar, the player or
    // find counts too, and nothing that stops propagation can hide it.
    for (const type of READER_INPUT) page.addEventListener(type, stop, { capture: true, passive: true })
    stopHoldRef.current = stop
    frame = requestAnimationFrame(hold)
  })
  useLayoutEffect(() => () => stopHoldRef.current?.(), [])

  return { keepReadingPosition, releaseReadingPosition }
}
