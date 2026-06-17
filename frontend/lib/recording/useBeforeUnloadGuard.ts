"use client"

import { useEffect } from 'react'

/**
 * Installs a `beforeunload` warning while a recording is active. Phase 3 lifts this
 * to app level (`RecordingSessionProvider`) so the warning survives in-app
 * navigation and stays through upload completion — leaving the JS runtime is the
 * dangerous boundary, not leaving `/recording/new`.
 *
 * Takes `active` as an argument rather than reading the recording context so it can
 * be called from the provider itself without a module import cycle.
 */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Modern browsers ignore the returned string, but a non-empty value is
      // required to trigger the native warning in some legacy paths.
      event.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
