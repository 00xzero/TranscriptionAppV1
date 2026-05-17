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
      className="flex items-center justify-between gap-3 rounded-md border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span>{message}</span>
      <span className="font-mono text-xs opacity-70">
        {pct}% / {thresholdPct}%+
      </span>
    </div>
  )
}
