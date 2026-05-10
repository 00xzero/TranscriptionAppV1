import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a duration in seconds as a clock string.
 *  - 'auto' (default): H:MM:SS only when hours > 0, else MM:SS
 *  - 'always': HH:MM:SS, always zero-padded
 *  - 'never':  MM:SS — hours roll into minutes
 */
export function formatClockTime(
  seconds: number,
  hoursMode: 'auto' | 'always' | 'never' = 'auto'
): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return hoursMode === 'always' ? '00:00:00' : '00:00'
  }
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = m.toString().padStart(2, '0')
  const ss = s.toString().padStart(2, '0')
  if (hoursMode === 'always') return `${h.toString().padStart(2, '0')}:${mm}:${ss}`
  if (hoursMode === 'auto' && h > 0) return `${h}:${mm}:${ss}`
  if (hoursMode === 'never') return `${Math.floor(seconds / 60)}:${ss}`
  return `${mm}:${ss}`
}
