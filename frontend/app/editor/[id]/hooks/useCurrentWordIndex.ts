import { useCallback, useSyncExternalStore } from 'react'
import type { PlaybackClock } from '../playbackClock'
import { findCurrentTokenIndex } from '../utils'

const subscribeToNothing = () => () => {}
const noIndex = () => null

/**
 * Index of the token being spoken, for the playing segment's card: -1 before
 * its first token, null when highlighting is off (another segment is playing,
 * this one is being edited, nothing has played yet, or server rendering).
 *
 * The store is always subscribed through the same hook call; `enabled` only
 * swaps the subscription and snapshot, so a disabled card never listens to the
 * clock. The snapshot is a primitive, so the card re-renders only when the
 * current word changes.
 */
export function useCurrentWordIndex({
  tokens,
  enabled,
  clock,
}: {
  tokens: readonly { startMs: number }[]
  enabled: boolean
  clock: PlaybackClock
}): number | null {
  const getSnapshot = useCallback(() => {
    if (!enabled) return null
    const ms = clock.getMs()
    return ms === null ? null : findCurrentTokenIndex(tokens, ms)
  }, [enabled, clock, tokens])

  return useSyncExternalStore(enabled ? clock.subscribe : subscribeToNothing, getSnapshot, noIndex)
}
