import { useEffect } from 'react'
import { SCROLL_INTENT_KEYS } from '../utils'

export function useUserScrollDetection({
  containerRef,
  disabled = false,
  isProgrammaticScrollActive,
  onUserScroll,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  disabled?: boolean
  isProgrammaticScrollActive: () => boolean
  onUserScroll: () => void
}) {
  useEffect(() => {
    if (disabled) return
    const container = containerRef.current
    if (!container) return

    let userIntentPending = false
    let intentResetTimer: number | undefined

    const clearIntentResetTimer = () => {
      if (intentResetTimer) {
        window.clearTimeout(intentResetTimer)
        intentResetTimer = undefined
      }
    }

    const markIntent = ({ resetAfterMs = 150 }: { resetAfterMs?: number | null } = {}) => {
      userIntentPending = true
      clearIntentResetTimer()
      if (resetAfterMs === null) return
      intentResetTimer = window.setTimeout(() => {
        userIntentPending = false
        intentResetTimer = undefined
      }, resetAfterMs)
    }

    const handleUserScroll = () => {
      if (!userIntentPending) return
      if (isProgrammaticScrollActive()) {
        userIntentPending = false
        clearIntentResetTimer()
        return
      }
      userIntentPending = false
      clearIntentResetTimer()
      onUserScroll()
    }

    const handleWheel = () => { markIntent() }
    const handleTouchStart = () => { markIntent({ resetAfterMs: null }) }
    const handlePointerDown = (e: PointerEvent) => {
      if (e.target === container) markIntent()
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
      markIntent()
    }

    container.addEventListener('scroll', handleUserScroll)
    container.addEventListener('wheel', handleWheel)
    container.addEventListener('touchstart', handleTouchStart)
    container.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('scroll', handleUserScroll)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      clearIntentResetTimer()
    }
  }, [disabled, containerRef, isProgrammaticScrollActive, onUserScroll])
}
