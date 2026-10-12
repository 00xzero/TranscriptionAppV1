'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react'
import { formatElapsedTime } from '@/lib/utils'

export type ScrubEndReason = 'release' | 'cancellation' | 'teardown'
export type ScrubEndHandler = (fraction: number, reason: ScrubEndReason) => void

interface ScrubOptions {
  duration: number
  fraction: number
  interactive?: boolean
  sourceKey?: string | null
  onSeek?: (fraction: number) => void
  /** Hold the sync/layout transaction without pausing playback. */
  onSeekStart?: () => void
  onSeekEnd?: ScrubEndHandler
  onScrubStart?: () => void
  onScrub?: (fraction: number) => void
  onScrubEnd?: ScrubEndHandler
}

interface Gesture {
  pointerId: number
  pointerType: string
  root: HTMLDivElement
  x: number
  y: number
  fraction: number
  dragging: boolean
  seeking: boolean
  preventTouchScroll: (event: TouchEvent) => void
  callbacks: ScrubOptions
}

export function clampScrubFraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function fractionAt(root: HTMLDivElement, clientX: number): number {
  const { left, width } = root.getBoundingClientRect()
  return width > 0 && Number.isFinite(width) ? clampScrubFraction((clientX - left) / width) : 0
}

/** Owns the pointer lifecycle; plain seeks never enter the paused drag path. */
export function useScrubGesture(options: ScrubOptions) {
  const callbacks = useRef(options)
  const gestureRef = useRef<Gesture | null>(null)
  const [previewFraction, setPreviewFraction] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const interactive = options.interactive !== false

  useLayoutEffect(() => { callbacks.current = options })

  const finish = useCallback((reason: ScrubEndReason) => {
    const gesture = gestureRef.current
    if (!gesture) return
    // Clear ownership first: callbacks and capture release can synchronously
    // disable/unmount the slider or dispatch lostpointercapture.
    gestureRef.current = null
    setPreviewFraction(null)
    setIsDragging(false)
    gesture.root.removeEventListener('touchmove', gesture.preventTouchScroll)
    if (gesture.dragging) {
      gesture.callbacks.onScrubEnd?.(gesture.fraction, reason)
    }
    if (gesture.seeking) gesture.callbacks.onSeekEnd?.(gesture.fraction, reason)
    try { gesture.root.releasePointerCapture(gesture.pointerId) } catch { /* Already released by the browser. */ }
  }, [])

  useLayoutEffect(() => {
    // Disabling a live slider must synchronously close its external seek lifecycle.
    if (!interactive) finish('cancellation')
  }, [interactive, finish])

  useLayoutEffect(() => () => finish('teardown'), [options.sourceKey, finish])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = callbacks.current
    if (current.interactive === false || !current.onSeek || gestureRef.current) return
    if (event.isPrimary === false || (event.pointerType !== 'touch' && event.button !== 0)) return
    const root = event.currentTarget
    const fraction = fractionAt(root, event.clientX)
    const preventTouchScroll = (touch: TouchEvent) => {
      // Pointer-event preventDefault alone cannot stop browser panning. Once
      // horizontal intent is accepted, retain it even if the finger drifts.
      if (gestureRef.current?.dragging && touch.touches.length === 1 && touch.cancelable) touch.preventDefault()
    }
    const gesture: Gesture = {
      pointerId: event.pointerId, pointerType: event.pointerType, root,
      x: event.clientX, y: event.clientY, fraction, dragging: false, seeking: false,
      preventTouchScroll, callbacks: current,
    }
    gestureRef.current = gesture
    if (event.pointerType === 'touch') root.addEventListener('touchmove', preventTouchScroll, { passive: false })
    try { root.setPointerCapture(event.pointerId) } catch { /* Capture may be unavailable after cancellation. */ }
    if (event.pointerType !== 'touch') {
      event.preventDefault()
      root.dataset.scrubPointerFocus = 'true'
      root.focus({ preventScroll: true })
      gesture.seeking = true
      current.onSeekStart?.()
      if (gestureRef.current !== gesture) return
      setPreviewFraction(fraction)
      current.onSeek(fraction)
    }
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const dx = Math.abs(event.clientX - gesture.x)
    const dy = Math.abs(event.clientY - gesture.y)
    if (!gesture.dragging) {
      if (gesture.pointerType === 'touch') {
        if (dy >= 8 && dy >= dx) { finish('cancellation'); return }
        if (dx < 8 || dx <= dy) return
      } else if (Math.hypot(dx, dy) < 3) return
      gesture.dragging = true
      gesture.root.dataset.scrubPointerFocus = 'true'
      gesture.root.focus({ preventScroll: true })
      setIsDragging(true)
      if (!gesture.seeking) {
        gesture.seeking = true
        gesture.callbacks.onSeekStart?.()
      }
      if (gestureRef.current !== gesture) return
      gesture.callbacks.onScrubStart?.()
      if (gestureRef.current !== gesture) return
    }
    event.preventDefault()
    gesture.fraction = fractionAt(gesture.root, event.clientX)
    setPreviewFraction(gesture.fraction)
    gesture.callbacks.onScrub?.(gesture.fraction)
  }, [finish])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.dragging) {
      gesture.fraction = fractionAt(gesture.root, event.clientX)
      gesture.callbacks.onScrub?.(gesture.fraction)
    } else if (gesture.pointerType === 'touch') {
      gesture.root.dataset.scrubPointerFocus = 'true'
      gesture.root.focus({ preventScroll: true })
      gesture.fraction = fractionAt(gesture.root, event.clientX)
      gesture.seeking = true
      gesture.callbacks.onSeekStart?.()
      if (gestureRef.current !== gesture) return
      gesture.callbacks.onSeek?.(gesture.fraction)
    }
    finish('release')
  }, [finish])

  const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId === event.pointerId) finish('cancellation')
  }, [finish])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    delete event.currentTarget.dataset.scrubPointerFocus
    const current = callbacks.current
    if (current.interactive === false) return
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!current.onSeek || gestureRef.current) return
    const steps: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      current.onSeek(event.key === 'Home' ? 0 : 1)
    } else if (event.key in steps) {
      event.preventDefault()
      if (Number.isFinite(current.duration) && current.duration > 0) {
        current.onSeek(clampScrubFraction(current.fraction + steps[event.key] / current.duration))
      }
    }
  }, [])

  const fraction = previewFraction ?? clampScrubFraction(options.fraction)
  const duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 0
  const seconds = fraction * duration
  return {
    isDragging,
    previewFraction,
    sliderProps: {
      onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
      onLostPointerCapture: onPointerCancel, onKeyDown,
      onBlur: (event: FocusEvent<HTMLDivElement>) => { delete event.currentTarget.dataset.scrubPointerFocus },
      tabIndex: interactive && options.onSeek ? 0 : -1,
      'aria-disabled': !interactive || !options.onSeek,
      'aria-orientation': 'horizontal' as const,
      'aria-valuemin': 0,
      'aria-valuemax': Math.floor(duration),
      'aria-valuenow': Math.min(Math.floor(duration), Math.floor(seconds)),
      'aria-valuetext': duration > 0
        ? `${formatElapsedTime(seconds * 1000)} of ${formatElapsedTime(duration * 1000)}`
        : 'Duration unavailable',
    },
  }
}
