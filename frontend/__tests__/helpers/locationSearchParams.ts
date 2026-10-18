import { useSyncExternalStore } from 'react'

/**
 * `useSearchParams` as Next's app router provides it in a browser: it follows
 * window.location, including window.history.pushState / replaceState and
 * Back / Forward. jsdom has no router, so mock next/navigation with this:
 *
 *   jest.mock('next/navigation', () => ({
 *     ...,
 *     useSearchParams: () => jest.requireActual('../helpers/locationSearchParams').useLocationSearchParams(),
 *   }))
 */
const CHANGE = 'test:locationchange'
let installed = false

function install() {
  if (installed) return
  installed = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history)
    window.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args)
      window.dispatchEvent(new Event(CHANGE))
    }
  }
}

function subscribe(onChange: () => void) {
  install()
  window.addEventListener(CHANGE, onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    window.removeEventListener(CHANGE, onChange)
    window.removeEventListener('popstate', onChange)
  }
}

const cache = new Map<string, URLSearchParams>()
function snapshot(): URLSearchParams {
  const search = window.location.search
  let params = cache.get(search)
  if (!params) cache.set(search, (params = new URLSearchParams(search)))
  return params
}

export function useLocationSearchParams(): URLSearchParams {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Waits for jsdom to finish a Back / Forward / go(), which it reports with popstate. */
export function nextPopState(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
}
