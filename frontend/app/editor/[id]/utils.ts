import type { Word } from './types'

export const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
export const SYNC_OFFSET_MS = 150
export const SEEK_LOCK_MS = 3000
export const PROGRAMMATIC_SCROLL_RESET_MS = 250
export const ACTIVE_CARD_VISIBILITY_MARGIN_PX = 24
export const ASCII_WORD_CHAR_REGEX = /[A-Za-z0-9_]/
// Scripts with little/no case mapping support; used for whole-word boundary checks.
export const NON_CASED_WORD_CHAR_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/
export const COMBINING_MARK_START = 0x0300
export const COMBINING_MARK_END = 0x036f
export const SCROLL_INTENT_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'])

export const isUnicodeWordChar = (char: string) => {
  if (!char) return false
  if (ASCII_WORD_CHAR_REGEX.test(char)) return true
  if (NON_CASED_WORD_CHAR_REGEX.test(char)) return true

  const code = char.charCodeAt(0)
  if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) return true

  // Unicode letters generally have different upper/lower-case transforms.
  return char.toLowerCase() !== char.toUpperCase()
}

export const computeWordsForSegment = (seg: { id: string; start_ms: number; end_ms: number; text: string }): Word[] => {
  const duration = Math.max(1, (seg.end_ms - seg.start_ms))
  const tokens = String(seg.text || '').split(/(\s+)/).filter(Boolean)
  const words: Word[] = []
  let cursor = 0
  const per = Math.floor(duration / Math.max(1, tokens.filter(t => !/^\s+$/.test(t)).length))
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^\s+$/.test(t)) {
      if (words.length > 0) words[words.length - 1].text += t
      continue
    }
    const start = seg.start_ms + cursor
    const end = i === tokens.length - 1 ? seg.end_ms : Math.min(seg.end_ms, start + per)
    cursor += per
    words.push({ key: `${seg.id}:${i}`, start_ms: start, end_ms: end, text: t })
  }
  return words
}

export const computeWordsForSegments = <T extends { id: string; start_ms: number; end_ms: number; text: string }>(
  items: T[]
): Array<T & { words: Word[] }> => items.map((s) => ({ ...s, words: computeWordsForSegment(s) }))

// Format date as "Oct 24, 2023"
export const formatProjectDate = (dateStr: string | null): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
}

// Format duration in seconds as "HH:MM:SS"
export const formatDurationHHMMSS = (seconds: number | null): string => {
  if (seconds === null || seconds === undefined) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
