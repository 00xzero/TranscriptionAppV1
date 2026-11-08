"use client"

import { useCallback, useRef } from 'react'

export function useDialogFocusRestore() {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const captureFocus = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    const activeElement = document.activeElement
    previousFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null
  }, [])

  const restoreFocus = useCallback((options?: FocusOptions) => {
    const previousFocus = previousFocusRef.current
    if (previousFocus?.isConnected) {
      window.setTimeout(() => previousFocus.focus(options), 0)
    }
  }, [])

  return { captureFocus, restoreFocus }
}
