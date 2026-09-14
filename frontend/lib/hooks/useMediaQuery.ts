'use client'

import { useCallback, useSyncExternalStore } from 'react'

const getServerSnapshot = () => false

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => undefined

    const mediaQuery = window.matchMedia(query)
    mediaQuery.addEventListener('change', onStoreChange)
    return () => mediaQuery.removeEventListener('change', onStoreChange)
  }, [query])

  const getSnapshot = useCallback(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
