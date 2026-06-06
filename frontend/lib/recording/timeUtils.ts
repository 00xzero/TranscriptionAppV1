import { formatClockTime } from '@/lib/utils'

export function formatElapsedTime(ms: number): string {
  return formatClockTime(ms / 1000, 'always')
}
