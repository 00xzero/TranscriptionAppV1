// Local Safari probing showed raw mic capture fades in for roughly 3.75s.
// Use a small margin so MediaRecorder starts after the input level stabilizes.
export const SAFARI_MIC_PREWARM_MS = 4000

export function isSafariBrowser(
  userAgent: string,
  vendor: string | undefined
): boolean {
  const ua = userAgent.toLowerCase()
  const browserVendor = (vendor ?? '').toLowerCase()

  return (
    browserVendor.includes('apple') &&
    ua.includes('safari') &&
    !ua.includes('chrome') &&
    !ua.includes('chromium') &&
    !ua.includes('crios') &&
    !ua.includes('fxios') &&
    !ua.includes('edgios') &&
    !ua.includes('android')
  )
}

export function shouldPrewarmSafariMic(): boolean {
  if (typeof navigator === 'undefined') return false
  return isSafariBrowser(navigator.userAgent, navigator.vendor)
}

export function isPrewarmAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err as { name?: string })?.name === 'AbortError'
  )
}

export function waitForSafariMicPrewarm(
  signal?: AbortSignal
): Promise<void> {
  if (!shouldPrewarmSafariMic()) return Promise.resolve()
  return waitForSafariMicPrewarmUntil(Date.now() + SAFARI_MIC_PREWARM_MS, signal)
}

export function waitForSafariMicPrewarmUntil(
  readyAt: number | null,
  signal?: AbortSignal
): Promise<void> {
  if (!shouldPrewarmSafariMic() || readyAt == null) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(signal.reason)

  const remainingMs = Math.max(0, readyAt - Date.now())
  if (remainingMs === 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let cleanup = () => {}
    const timeoutId = window.setTimeout(() => {
      cleanup()
      resolve()
    }, remainingMs)

    const abort = () => {
      window.clearTimeout(timeoutId)
      cleanup()
      reject(signal?.reason ?? new DOMException('Prewarm canceled.', 'AbortError'))
    }

    cleanup = () => {
      signal?.removeEventListener('abort', abort)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
