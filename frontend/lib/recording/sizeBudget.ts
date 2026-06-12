export const WARMUP_MS = 5_000
export const BANNER_THRESHOLD_FRACTION = 0.8
export const EMPTY_FLOOR_MS = 2_000
export const EMPTY_FLOOR_BYTES = 4_096
// Stop a little before the hard storage cap so the recorder's final flush
// still has room to land without making the eventual upload oversized.
export const AUTO_STOP_HEADROOM_FRACTION = 0.97

export function computeObservedBitrate(bytes: number, activeMs: number): number | null {
  if (activeMs <= 0) return null
  return (bytes / activeMs) * 1000
}

export function predictRemainingMs(
  bytes: number,
  observedBitrate: number | null,
  maxBytes: number
): number | null {
  if (observedBitrate == null || observedBitrate <= 0) return null
  const remainingBytes = Math.max(maxBytes - bytes, 0)
  return (remainingBytes / observedBitrate) * 1000
}

export function shouldShowBanner(bytes: number, maxBytes: number): boolean {
  if (maxBytes <= 0) return false
  return bytes >= maxBytes * BANNER_THRESHOLD_FRACTION
}

export function shouldAutoStop(bytes: number, maxBytes: number): boolean {
  if (maxBytes <= 0) return false
  return bytes >= maxBytes * AUTO_STOP_HEADROOM_FRACTION
}

export function isWarmupComplete(activeMs: number): boolean {
  return activeMs >= WARMUP_MS
}

export function meetsEmptyFloor(activeMs: number, bytes: number): boolean {
  return activeMs >= EMPTY_FLOOR_MS && bytes >= EMPTY_FLOOR_BYTES
}
