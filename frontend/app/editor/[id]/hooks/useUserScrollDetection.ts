import { useEffect } from 'react'
import { SCROLL_INTENT_KEYS } from '../utils'

export function useUserScrollDetection({
  containerRef,
  isUserScrollingRef,
  isProgrammaticScrollRef,
  programmaticScrollResetTimerRef,
  setIsFollowMode,
  setHasUserScrolled,
  speakerPopover,
}: {
  containerRef: React.MutableRefObject<HTMLDivElement | null>
  isUserScrollingRef: React.MutableRefObject<boolean>
  isProgrammaticScrollRef: React.MutableRefObject<boolean>
  programmaticScrollResetTimerRef: React.MutableRefObject<number | null>
  setIsFollowMode: (v: boolean) => void
  setHasUserScrolled: (v: boolean) => void
  speakerPopover: unknown
}) {
  useEffect(() => {
    if (speakerPopover) return
    const container = containerRef.current
    if (!container) return

    const handleUserScroll = () => {
      if (isProgrammaticScrollRef.current) return
      if (isUserScrollingRef.current) {
        setIsFollowMode(false)
        setHasUserScrolled(true)
      }
    }

    const handleWheel = () => { isUserScrollingRef.current = true }
    const handleTouchStart = () => { isUserScrollingRef.current = true }
    const handlePointerDown = (e: PointerEvent) => {
      if (e.target === container) isUserScrollingRef.current = true
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (!SCROLL_INTENT_KEYS.has(e.key)) return
      const target = e.target instanceof HTMLElement ? e.target : null
      const isEditableTarget =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      const isInteractiveTarget = !!(target && target.closest(
        'button, a[href], select, [role="button"], [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
      ))
      if (isEditableTarget || isInteractiveTarget) return
      isUserScrollingRef.current = true
    }
    let scrollEndTimer: number | undefined
    const handleScrollEnd = () => {
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer)
      scrollEndTimer = window.setTimeout(() => {
        isUserScrollingRef.current = false
        isProgrammaticScrollRef.current = false
      }, 100)
    }

    container.addEventListener('scroll', handleUserScroll)
    container.addEventListener('scroll', handleScrollEnd)
    container.addEventListener('wheel', handleWheel)
    container.addEventListener('touchstart', handleTouchStart)
    container.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('scroll', handleUserScroll)
      container.removeEventListener('scroll', handleScrollEnd)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer)
      if (programmaticScrollResetTimerRef.current) {
        window.clearTimeout(programmaticScrollResetTimerRef.current)
        programmaticScrollResetTimerRef.current = null
      }
      isUserScrollingRef.current = false
      isProgrammaticScrollRef.current = false
    }
  }, [speakerPopover, containerRef, isUserScrollingRef, isProgrammaticScrollRef, programmaticScrollResetTimerRef, setIsFollowMode, setHasUserScrolled])
}
