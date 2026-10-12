/**
 * The audio position for the playing-word highlight, as a tiny external store.
 *
 * It reads the media element's real position (so backward seeks and playback
 * rate changes need no special handling) once per animation frame while
 * playing, and on demand otherwise. The scroll-sync machine's active segment is
 * a different thing: it advances on `timeupdate` (about 4 times a second) and
 * holds still for a few seconds after a seek, which suits scrolling but is too
 * coarse for marking the word being spoken.
 */
export type PlaybackClock = {
  /** Read positions from this source (the audio player), or from nothing when null. */
  attach: (readMs: (() => number) | null) => void
  /** Position in ms, or null until playback has started or a seek has completed. */
  getMs: () => number | null
  subscribe: (listener: () => void) => () => void
  /** Re-read the position; call after the media element's position has actually changed. */
  refresh: () => void
  /** Begin reading every animation frame. */
  start: () => void
  /** Stop the frame loop. */
  stop: () => void
}

export function createPlaybackClock(): PlaybackClock {
  let readMs: (() => number) | null = null
  let ms: number | null = null
  let frame: number | null = null
  const listeners = new Set<() => void>()

  const refresh = () => {
    if (!readMs) return
    const next = readMs()
    if (next === ms) return
    ms = next
    listeners.forEach((listener) => listener())
  }

  const tick = () => {
    frame = requestAnimationFrame(tick)
    refresh()
  }

  return {
    attach: (source) => { readMs = source },
    getMs: () => ms,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh,
    start: () => {
      if (frame !== null) return
      refresh()
      frame = requestAnimationFrame(tick)
    },
    stop: () => {
      if (frame === null) return
      cancelAnimationFrame(frame)
      frame = null
    },
  }
}
