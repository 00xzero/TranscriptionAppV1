import { useCallback, useMemo, useRef, type RefObject } from 'react'

/**
 * Focus for a popover opened from a menu item rather than its own trigger:
 * when it closes, focus goes back to the button inside `anchor`. Radix does
 * this itself only for a PopoverTrigger, and skips it after a click or focus
 * outside, which leaves focus where the person put it. This keeps that rule.
 */
export function useAnchoredFocusReturn(anchor: RefObject<HTMLElement | null>) {
  const leftOutside = useRef(false)

  const onInteractOutside = useCallback(() => { leftOutside.current = true }, [])
  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    if (!leftOutside.current) anchor.current?.querySelector('button')?.focus()
    leftOutside.current = false
  }, [anchor])

  return useMemo(() => ({ onInteractOutside, onCloseAutoFocus }), [onInteractOutside, onCloseAutoFocus])
}
