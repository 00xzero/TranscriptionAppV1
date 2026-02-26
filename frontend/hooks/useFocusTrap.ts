import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Lightweight focus trap: keeps Tab / Shift+Tab within `containerRef`.
 * Saves the previously-focused element and restores it on cleanup.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return

    // Save the element that had focus before the trap opened
    previousFocusRef.current = document.activeElement as HTMLElement | null

    const container = containerRef.current
    if (!container) return
    let addedTemporaryTabIndex = false

    const focusContainerFallback = () => {
      if (!container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1')
        addedTemporaryTabIndex = true
      }
      container.focus()
    }

    // Focus first focusable element inside the container
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables.length > 0) {
      focusables[0].focus()
    } else {
      focusContainerFallback()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (elements.length === 0) {
        e.preventDefault()
        focusContainerFallback()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (addedTemporaryTabIndex) {
        container.removeAttribute('tabindex')
      }
      // Restore previous focus
      previousFocusRef.current?.focus()
    }
  }, [active, containerRef])
}
