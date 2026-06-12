"use client"

import {
  BANNER_THRESHOLD_FRACTION,
  computeObservedBitrate,
  isWarmupComplete,
  predictRemainingMs,
  shouldShowBanner,
} from '@/lib/recording/sizeBudget'
import {
  getElapsedActiveMs,
  type SessionSnapshot,
} from '@/lib/recording/session'

interface SizeBudgetBannerProps {
  snapshot: SessionSnapshot
  maxBytes: number
}

function formatMinutes(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.max(1, Math.round(totalSeconds / 60))
  return `${minutes} min`
}

export default function SizeBudgetBanner({ snapshot, maxBytes }: SizeBudgetBannerProps) {
  if (maxBytes <= 0) return null
  if (!shouldShowBanner(snapshot.bytesSoFar, maxBytes)) return null

  const activeMs = getElapsedActiveMs(snapshot)
  const bitrate = computeObservedBitrate(snapshot.bytesSoFar, activeMs)
  const remainingMs = predictRemainingMs(snapshot.bytesSoFar, bitrate, maxBytes)

  const showPrediction =
    isWarmupComplete(activeMs) && remainingMs != null && remainingMs > 0

  const message = showPrediction
    ? `Approaching size limit — about ${formatMinutes(remainingMs)} left.`
    : 'Approaching size limit.'

  const pct = Math.round((snapshot.bytesSoFar / maxBytes) * 100)
  const thresholdPct = Math.round(BANNER_THRESHOLD_FRACTION * 100)

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="recording-size-banner"
      className="flex items-center justify-between gap-3 rounded-md border border-ink/15 bg-warm-highlight px-4 py-2 text-sm text-ink dark:border-night-border dark:bg-night-surface/60 dark:text-paper"
    >
      <span>{message}</span>
      <span className="font-mono text-xs opacity-70">
        {pct}% / {thresholdPct}%+
      </span>
    </div>
  )
}
