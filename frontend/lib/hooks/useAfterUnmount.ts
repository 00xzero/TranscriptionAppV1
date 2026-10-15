import { useCallback, useEffect, useRef } from 'react'

/**
 * Runs what `onUnmount` returns once the component has really gone, at the
 * next task: an effect run again at once (Fast Refresh, Strict Mode, or a
 * new `onUnmount`) cancels it. `onUnmount` itself runs at the unmount, to
 * read what the component holds at that moment. Pass a stable callback.
 *
 * Returns whether the component is mounted, read synchronously: false from
 * the unmount on, true again if the effect runs again.
 */
export function useAfterUnmount(onUnmount: () => () => void): () => boolean {
  const mounted = useRef(true)
  const closing = useRef<number | null>(null)
  useEffect(() => {
    mounted.current = true
    if (closing.current !== null) { window.clearTimeout(closing.current); closing.current = null }
    return () => {
      mounted.current = false
      const after = onUnmount()
      closing.current = window.setTimeout(() => {
        closing.current = null
        after()
      }, 0)
    }
  }, [onUnmount])
  return useCallback(() => mounted.current, [])
}
