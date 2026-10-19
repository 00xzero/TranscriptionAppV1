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
  if (hoursMode === 'never') return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${ss}`
  return `${mm}:${ss}`
}

/** Format elapsed milliseconds as a zero-padded HH:MM:SS clock. */
export function formatElapsedTime(ms: number): string {
  return formatClockTime(ms / 1000, 'always')
}

/** "48 of 182 MB": the part sent, in the whole file's unit. */
export function formatUploadedBytes(sentBytes: number, totalBytes: number): string {
  const [totalShown, unit] = formatFileSize(totalBytes).split(' ')
  // The count says the whole size only once it is all in. Until then it stays
  // a step below the shown total, which is rounded and can sit under the real
  // one (6.4 MB shows as "6 MB").
  if (sentBytes >= totalBytes) return `${totalShown} of ${totalShown} ${unit}`
  const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit] ?? 1
  const step = unit === 'GB' ? 0.1 : 1
  const floored = Math.floor(sentBytes / scale / step) * step
  const sent = Math.max(0, Math.min(floored, Number(totalShown) - step))
  const shown = unit === 'GB' ? sent.toFixed(1) : String(Math.round(sent))
  return `${shown} of ${totalShown} ${unit}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
