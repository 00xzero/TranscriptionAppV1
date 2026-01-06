"use client"
import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { getApiBase, getAuthHeaders } from '../../../lib/api'

type Word = { key: string; start_ms: number; end_ms: number; text: string }
type Seg = { id: string; start_ms: number; end_ms: number; text: string; speaker_id?: string | null; words?: Word[] }
type Speaker = { id: string; project_id: string; label: string; color?: string | null }
type Match = { segId: string; cardKey: string; index: number; length: number }
type SegmentMatch = { index: number; length: number; matchIdx: number }

const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
const SYNC_OFFSET_MS = 150

// Extended segment type for display (includes grouping info)
type DisplaySeg = Seg & {
  isFirstInGroup: boolean  // True if this is the first card in a speaker group
  groupIndex: number       // Index within the speaker group (0, 1, 2...)
  cardKey: string          // Unique key for this display card (id + groupIndex)
}

// Configuration for word-count-based chunking
const TARGET_WORDS_PER_CARD = 40
const MIN_WORDS_PER_CARD = 35
const MAX_WORDS_PER_CARD = 50

/**
 * Normalize segments by:
 * 1. Grouping consecutive same-speaker segments
 * 2. Pooling their words together
 * 3. Re-chunking into ~35-45 word display segments
 * 
 * This merges tiny fragments and splits large monologues.
 */
function normalizeSegments(segments: Seg[]): DisplaySeg[] {
  if (segments.length === 0) return []

  const result: DisplaySeg[] = []

  // Step 1: Group consecutive same-speaker segments
  const speakerGroups: Seg[][] = []
  let currentGroup: Seg[] = []
  let currentSpeakerId = segments[0].speaker_id

  for (const segment of segments) {
    if (segment.speaker_id === currentSpeakerId) {
      currentGroup.push(segment)
    } else {
      if (currentGroup.length > 0) {
        speakerGroups.push(currentGroup)
      }
      currentGroup = [segment]
      currentSpeakerId = segment.speaker_id
    }
  }
  if (currentGroup.length > 0) {
    speakerGroups.push(currentGroup)
  }

  // Step 2: Process each speaker group
  for (const group of speakerGroups) {
    const chunked = chunkSpeakerGroup(group)
    result.push(...chunked)
  }

  return result
}

/**
 * Chunk a speaker group into ~35-45 word display segments.
 * Preserves word-level timing for accurate timestamps.
 */
function chunkSpeakerGroup(group: Seg[]): DisplaySeg[] {
  const speakerId = group[0].speaker_id
  const firstSegmentId = group[0].id

  // Collect all words from all segments in this group
  type WordWithTiming = { text: string; start_ms: number; end_ms: number; segmentId: string }
  const allWords: WordWithTiming[] = []

  for (const seg of group) {
    // If segment has word-level timing, use it
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) {
        allWords.push({
          text: w.text.trim(),
          start_ms: w.start_ms,
          end_ms: w.end_ms,
          segmentId: seg.id,
        })
      }
    } else {
      // Otherwise, estimate word timings from segment
      const words = seg.text.split(/\s+/).filter(Boolean)
      if (words.length === 0) continue

      const duration = seg.end_ms - seg.start_ms
      const perWord = duration / words.length

      words.forEach((word, i) => {
        allWords.push({
          text: word,
          start_ms: Math.round(seg.start_ms + i * perWord),
          end_ms: Math.round(seg.start_ms + (i + 1) * perWord),
          segmentId: seg.id,
        })
      })
    }
  }

  // Filter out empty words
  const validWords = allWords.filter(w => w.text.length > 0)

  if (validWords.length === 0) {
    // Return single empty segment
    const emptyCardKey = `${firstSegmentId}-chunk-0`
    return [{
      id: firstSegmentId,
      start_ms: group[0].start_ms,
      end_ms: group[group.length - 1].end_ms,
      text: '',
      speaker_id: speakerId,
      words: [],
      isFirstInGroup: true,
      groupIndex: 0,
      cardKey: emptyCardKey,
    }]
  }

  // Chunk words into ~35-45 word segments
  const chunks: DisplaySeg[] = []
  let chunkStart = 0
  let groupIndex = 0

  while (chunkStart < validWords.length) {
    // Determine chunk size: aim for TARGET, but allow MIN to MAX
    let chunkEnd = Math.min(chunkStart + TARGET_WORDS_PER_CARD, validWords.length)

    // If remaining words would leave a tiny orphan chunk, absorb them
    const remaining = validWords.length - chunkEnd
    if (remaining > 0 && remaining < MIN_WORDS_PER_CARD) {
      // Either extend current chunk or leave for next iteration
      if (chunkEnd - chunkStart + remaining <= MAX_WORDS_PER_CARD) {
        chunkEnd = validWords.length // Absorb remaining
      }
    }

    // Try to break at sentence boundary if possible
    chunkEnd = findSentenceBoundary(validWords, chunkStart, chunkEnd)

    const chunkWords = validWords.slice(chunkStart, chunkEnd)
    const chunkText = chunkWords.map(w => w.text).join(' ')
    const chunkStartMs = chunkWords[0].start_ms
    const chunkEndMs = chunkWords[chunkWords.length - 1].end_ms

    // Use the first source segment's ID for this chunk (for editing)
    const sourceIds = Array.from(new Set(chunkWords.map(w => w.segmentId)))

    // Generate unique cardKey for this chunk (for state tracking)
    const cardKey = `${sourceIds[0]}-chunk-${groupIndex}`

    chunks.push({
      id: sourceIds[0], // Primary segment ID for API saving
      start_ms: chunkStartMs,
      end_ms: chunkEndMs,
      text: chunkText,
      speaker_id: speakerId,
      words: chunkWords.map((w, i) => ({
        key: `${cardKey}:word-${i}`,
        start_ms: w.start_ms,
        end_ms: w.end_ms,
        text: w.text,
      })),
      isFirstInGroup: groupIndex === 0,
      groupIndex: groupIndex,
      cardKey: cardKey, // Unique identifier for this display chunk
    })

    chunkStart = chunkEnd
    groupIndex++
  }

  return chunks
}

/**
 * Find a good sentence boundary near the target end position.
 * Looks for sentence-ending punctuation (.!?) followed by a word.
 */
function findSentenceBoundary(
  words: { text: string }[],
  start: number,
  targetEnd: number
): number {
  // Don't adjust if we're at the end
  if (targetEnd >= words.length) return targetEnd

  // Look backward from targetEnd for a sentence boundary
  const searchStart = Math.max(start + MIN_WORDS_PER_CARD, targetEnd - 10)

  for (let i = targetEnd - 1; i >= searchStart; i--) {
    const word = words[i].text
    if (/[.!?]$/.test(word)) {
      return i + 1 // Break after this word
    }
  }

  // No good boundary found, use original target
  return targetEnd
}

export default function EditorPage({ params }: { params: { id: string } }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [segments, setSegments] = useState<DisplaySeg[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [follow, setFollow] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const activeSegRef = useRef<HTMLDivElement | null>(null)
  const [activeIds, setActiveIds] = useState<{ segId?: string; wordKey?: string }>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTexts, setEditingTexts] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const saveTimers = useRef<Record<string, number>>({})
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [findInput, setFindInput] = useState('')
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)


  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const base = getApiBase()
        const res = await fetch(`${base}/projects/${params.id}/media-url`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) throw new Error(`Failed to fetch media URL: ${res.status}`)
        const j = await res.json()
        const url: string = j.url

        if (!containerRef.current) return
        // If an instance already exists (e.g., StrictMode remount), tear it down first
        if (wavesurferRef.current) {
          try { wavesurferRef.current.destroy() } catch { }
          wavesurferRef.current = null
        }
        // Ensure the container is empty (StrictMode double-effect in dev may leave remnants)
        try { containerRef.current.replaceChildren() } catch { containerRef.current.innerHTML = '' }
        const ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#9CA3AF',
          progressColor: '#2563EB',
          cursorColor: '#111827',
          height: 96,
        })
        wavesurferRef.current = ws
        ws.on('ready', () => { if (cancelled) return; setReady(true); setStatus('Ready'); ws.setPlaybackRate(playbackRate) })
        ws.on('error', (e: unknown) => { setStatus(`Error: ${String(e)}`) })
        ws.on('play', () => setPlaying(true))
        ws.on('pause', () => setPlaying(false))
        await ws.load(url)

        // Load segments
        const segRes = await fetch(`${base}/projects/${params.id}/segments`, {
          headers: getAuthHeaders(),
        })
        if (!cancelled && segRes.ok) {
          const segs = await segRes.json()

          // DEBUG: Log raw API response to understand segmentation
          console.log('=== DEBUG: Raw segments from API ===')
          console.log('Number of segments:', segs.length)
          console.log('Segment details:', segs.map((s: any) => ({
            id: s.id,
            speaker_id: s.speaker_id,
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text?.substring(0, 50) + (s.text?.length > 50 ? '...' : ''),
            duration: s.end_ms - s.start_ms
          })))
          console.log('=== END DEBUG ===')

          // Normalize segments: merge small fragments, split large ones into ~40 word chunks
          const normalizedSegments = normalizeSegments(segs)

          console.log('=== DEBUG: After normalizing ===')
          console.log('Number of display segments:', normalizedSegments.length)
          console.log('Segment details:', normalizedSegments.map((s: DisplaySeg) => ({
            id: s.id,
            speaker_id: s.speaker_id,
            isFirstInGroup: s.isFirstInGroup,
            groupIndex: s.groupIndex,
            wordCount: s.text.split(/\s+/).filter(Boolean).length,
            text: s.text?.substring(0, 60) + (s.text?.length > 60 ? '...' : ''),
          })))
          console.log('=== END NORMALIZE DEBUG ===')

          setSegments(normalizedSegments)
        }

        // Load speakers
        try {
          const spRes = await fetch(`${base}/projects/${params.id}/speakers`, {
            headers: getAuthHeaders(),
          })
          if (!cancelled && spRes.ok) {
            const sps: Speaker[] = await spRes.json()
            setSpeakers(sps)
          }
        } catch (_) { /* ignore */ }

        const onProcess = () => {
          const tSec = ws.getCurrentTime() || 0
          const tMs = Math.floor(tSec * 1000)
          const tAdj = Math.max(0, tMs - SYNC_OFFSET_MS)
          let activeCardKey: string | undefined
          for (const s of segmentsRef.current) {
            if (tAdj >= s.start_ms && tAdj <= s.end_ms) {
              // Use unique card key (ID + groupIndex) to identify the specific chunk
              activeCardKey = `${s.id}-chunk-${s.groupIndex ?? 0}`
              break
            }
          }
          setActiveIds({ segId: activeCardKey, wordKey: undefined })
        }

        ws.on('audioprocess', onProcess)

      } catch (e: any) {
        console.error(e)
        setStatus(`Error: ${e.message || e}`)
      }
    }
    init()
    return () => {
      cancelled = true
      wavesurferRef.current?.destroy()
      wavesurferRef.current = null
      // Also clear the container in case destroy() didn't remove canvases
      try { containerRef.current?.replaceChildren() } catch { if (containerRef.current) containerRef.current.innerHTML = '' }
    }
  }, [params.id])

  const togglePlay = () => {
    const ws = wavesurferRef.current
    if (!ws) return
    ws.isPlaying() ? ws.pause() : ws.play()
  }

  const seekRelative = (sec: number) => {
    const ws = wavesurferRef.current
    if (!ws) return
    const dur = ws.getDuration() || 0
    const cur = ws.getCurrentTime() || 0
    let next = cur + sec
    if (next < 0) next = 0
    if (next > dur) next = dur
    ws.setTime(next)
  }

  // Keep a ref to latest segments to use inside WS callbacks
  const segmentsRef = useRef(segments)
  useEffect(() => { segmentsRef.current = segments }, [segments])

  // Auto-scroll to active segment
  useEffect(() => {
    if (!follow) return
    if (activeSegRef.current) {
      activeSegRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeIds.segId, follow])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return }
      if (e.key.toLowerCase() === 'j') { seekRelative(-2); return }
      if (e.key.toLowerCase() === 'l') { seekRelative(2); return }
      if (e.key === ',') { seekRelative(-0.25); return }
      if (e.key === '.') { seekRelative(0.25); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onWordClick = (ms: number) => {
    const ws = wavesurferRef.current
    if (!ws) return
    ws.setTime(ms / 1000)
  }

  const onSegmentClick = (ms: number) => onWordClick(ms)

  const onRateChange = (r: number) => {
    setPlaybackRate(r)
    const ws = wavesurferRef.current
    if (ws) ws.setPlaybackRate(r)
  }

  // Debounced save of segment text
  const recomputeWords = (seg: { id: string; start_ms: number; end_ms: number; text: string }): Word[] => {
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

  const scheduleSave = useCallback((cardKey: string, segmentId: string, newText: string) => {
    // update UI immediately - use cardKey to find the specific chunk
    setSegments((prev: DisplaySeg[]) => prev.map((s: DisplaySeg) => s.cardKey === cardKey ? { ...s, text: newText, words: recomputeWords({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, text: newText }) } : s))
    setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [cardKey]: 'saving' }))

    // clear existing timer - use cardKey for timer tracking
    const t = saveTimers.current[cardKey]
    if (t) { window.clearTimeout(t); delete saveTimers.current[cardKey] }

    // debounce before saving - use segmentId for API call
    const timerId = window.setTimeout(async () => {
      try {
        const res = await fetch(`${getApiBase()}/segments/${segmentId}`, {
          method: 'PATCH',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText }),
        })
        if (!res.ok) throw new Error(String(res.status))
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [cardKey]: 'saved' }))
        // reset saved flag after a moment
        window.setTimeout(() => setSaveStatus((p: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...p, [cardKey]: 'idle' })), 1200)
      } catch (e) {
        console.error('save failed', e)
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [cardKey]: 'error' }))
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current[cardKey] = timerId
  }, [])

  const matches = useMemo<Match[]>(() => {
    if (!findTerm) return []
    const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
    if (!needle.length) return []
    const found: Match[] = []
    for (const seg of segments) {
      // Use cardKey for text lookup since editingTexts is now keyed by cardKey
      const text = editingTexts[seg.cardKey] ?? seg.text ?? ''
      const haystack = caseSensitive ? text : text.toLowerCase()
      let start = 0
      while (true) {
        const idx = haystack.indexOf(needle, start)
        if (idx === -1) break
        found.push({ segId: seg.id, cardKey: seg.cardKey, index: idx, length: needle.length })
        start = idx + Math.max(needle.length, 1)
      }
    }
    return found
  }, [segments, editingTexts, findTerm, caseSensitive])

  const matchesBySeg = useMemo(() => {
    const map = new Map<string, SegmentMatch[]>()
    matches.forEach((match: Match, idx: number) => {
      const arr = map.get(match.segId) ?? []
      arr.push({ index: match.index, length: match.length, matchIdx: idx })
      map.set(match.segId, arr)
    })
    return map
  }, [matches])

  const speakersMap = useMemo(() => {
    const m = new Map<string, Speaker>()
    speakers.forEach((sp) => m.set(sp.id, sp))
    return m
  }, [speakers])

  const getInitials = useCallback((name: string) => {
    const parts = (name || 'Unknown').trim().split(/\s+/)
    const first = parts[0]?.[0] || ''
    const second = parts[1]?.[0] || ''
    const initials = (first + second) || 'U'
    return initials.toUpperCase()
  }, [])

  const colorForSpeaker = useCallback((sp?: Speaker) => {
    if (sp?.color) return sp.color
    const key = sp?.id || sp?.label || 'unknown'
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0
    }
    const palette = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#14B8A6', '#8B5CF6', '#F472B6', '#22C55E', '#EAB308', '#0EA5E9']
    return palette[hash % palette.length]
  }, [])

  const totalMatches = matches.length
  const currentMatch = totalMatches ? matches[Math.min(matchIndex, totalMatches - 1)] : null

  useEffect(() => {
    if (totalMatches === 0 && matchIndex !== 0) {
      setMatchIndex(0)
      return
    }
    if (totalMatches > 0 && matchIndex >= totalMatches) {
      setMatchIndex(totalMatches - 1)
    }
  }, [totalMatches, matchIndex])

  useEffect(() => {
    setMatchIndex(0)
  }, [findTerm, caseSensitive])

  useEffect(() => {
    if (!currentMatch) return
    const seg = segments.find((s: Seg) => s.id === currentMatch.segId)
    if (!seg) return

    if (editingId !== seg.id) {
      setEditingId(seg.id)
      setEditingTexts((prev: Record<string, string>) => prev[seg.id] !== undefined ? prev : { ...prev, [seg.id]: seg.text })
      return
    }

    if (editingTexts[seg.id] === undefined) {
      setEditingTexts((prev: Record<string, string>) => ({ ...prev, [seg.id]: seg.text }))
      return
    }

    const area = textAreaRefs.current[seg.id]
    if (area) {
      try {
        area.focus()
        if (typeof area.setSelectionRange === 'function') {
          const start = Math.max(0, Math.min(currentMatch.index, (area.value ?? '').length))
          const end = Math.max(start, Math.min(currentMatch.index + currentMatch.length, (area.value ?? '').length))
          area.setSelectionRange(start, end)
        }
        if (typeof area.scrollIntoView === 'function') {
          area.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } catch (_) {
        // ignore selection errors in non-browser envs
      }
    }

    const card = segmentRefs.current[seg.id]
    try {
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) { /* noop */ }
  }, [currentMatch, segments, editingId, editingTexts])

  const goToDelta = useCallback((delta: number) => {
    if (!totalMatches) return
    setMatchIndex((prev: number) => {
      const next = (prev + delta + totalMatches) % totalMatches
      return next
    })
  }, [totalMatches])

  const handlePrev = useCallback(() => goToDelta(-1), [goToDelta])
  const handleNext = useCallback(() => goToDelta(1), [goToDelta])

  const handleReplace = useCallback(() => {
    if (!currentMatch) return
    const seg = segments.find((s: DisplaySeg) => s.cardKey === currentMatch.cardKey)
    if (!seg) return
    const text = editingTexts[seg.cardKey] ?? seg.text ?? ''
    const before = text.slice(0, currentMatch.index)
    const after = text.slice(currentMatch.index + currentMatch.length)
    const updated = before + replaceTerm + after
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, [seg.cardKey]: updated }))
    scheduleSave(seg.cardKey, seg.id, updated)
    handleNext()
  }, [currentMatch, segments, editingTexts, replaceTerm, scheduleSave, handleNext])

  const handleReplaceAll = useCallback(() => {
    if (!totalMatches) return
    const baseTexts: Record<string, string> = {}
    segments.forEach((seg: DisplaySeg) => {
      baseTexts[seg.cardKey] = editingTexts[seg.cardKey] ?? seg.text ?? ''
    })
    const shifts: Record<string, number> = {}
    const updatedTexts: Record<string, string> = {}
    // Track which cardKey maps to which segmentId for API calls
    const cardKeyToSegId: Record<string, string> = {}
    segments.forEach((seg: DisplaySeg) => {
      cardKeyToSegId[seg.cardKey] = seg.id
    })

    matches.forEach((match: Match) => {
      const cardKey = match.cardKey
      const prior = updatedTexts[cardKey] ?? baseTexts[cardKey]
      const shift = shifts[cardKey] ?? 0
      const idx = match.index + shift
      const before = prior.slice(0, idx)
      const after = prior.slice(idx + match.length)
      const updated = before + replaceTerm + after
      updatedTexts[cardKey] = updated
      shifts[cardKey] = shift + replaceTerm.length - match.length
    })

    if (Object.keys(updatedTexts).length === 0) return
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, ...updatedTexts }))
    Object.entries(updatedTexts).forEach(([cardKey, text]) => scheduleSave(cardKey, cardKeyToSegId[cardKey], text))
  }, [totalMatches, matches, segments, editingTexts, replaceTerm, scheduleSave])

  const applyFindTerm = useCallback(() => {
    setFindTerm(findInput)
  }, [findInput])

  const onFindKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (findInput !== findTerm) {
      applyFindTerm()
      return
    }
    if (e.shiftKey) {
      handlePrev()
    } else {
      handleNext()
    }
  }, [findInput, findTerm, applyFindTerm, handlePrev, handleNext])

  const hasMatches = totalMatches > 0
  const isFindDirty = findInput !== findTerm
  const canNavigate = hasMatches && !isFindDirty
  const matchSummary = isFindDirty ? 'Press Search' : (totalMatches ? `${matchIndex + 1}/${totalMatches}` : '0 matches')


  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Editor: {params.id}</h1>
      <div className="bg-surface border border-base rounded p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-muted uppercase tracking-wide">Find</label>
            <input
              className="border border-base rounded px-2 py-1 bg-surface text-current min-w-[200px]"
              value={findInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFindInput(e.target.value)}
              onKeyDown={onFindKeyDown}
              placeholder="Search text"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted uppercase tracking-wide">Replace</label>
            <input
              className="border border-base rounded px-2 py-1 bg-surface text-current min-w-[200px]"
              value={replaceTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReplaceTerm(e.target.value)}
              placeholder="Replacement"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={caseSensitive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCaseSensitive(e.target.checked)} />
            Match case
          </label>
          <button
            className="px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50"
            onClick={applyFindTerm}
            disabled={!findInput.trim() && !findTerm.trim()}
          >Search</button>
          <span data-testid="match-summary" className="text-sm text-muted ml-auto">{matchSummary}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-1.5 rounded border border-base bg-surface-alt disabled:opacity-50"
            onClick={handlePrev}
            disabled={!canNavigate}
          >Prev</button>
          <button
            className="px-3 py-1.5 rounded border border-base bg-surface-alt disabled:opacity-50"
            onClick={handleNext}
            disabled={!canNavigate}
          >Next</button>
          <button
            className="px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50"
            onClick={handleReplace}
            disabled={!canNavigate}
          >Replace</button>
          <button
            className="px-3 py-1.5 rounded bg-emerald-700 text-white disabled:opacity-50"
            onClick={handleReplaceAll}
            disabled={!canNavigate}
          >Replace all</button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-surface border border-base rounded p-4 space-y-3">
          <div ref={containerRef} className="wavesurfer" />
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!ready} onClick={togglePlay}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="px-3 py-1.5 rounded bg-surface-alt" onClick={() => seekRelative(-2)}>-2s</button>
            <button className="px-3 py-1.5 rounded bg-surface-alt" onClick={() => seekRelative(2)}>+2s</button>
            <div className="ml-2 flex items-center gap-1">
              <label className="text-sm text-muted">Rate</label>
              <select
                className="border border-base rounded px-2 py-1 text-sm bg-surface text-current focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                value={playbackRate}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onRateChange(parseFloat(e.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => (
                  <option key={r} value={r}>{r.toFixed(2)}x</option>
                ))}
              </select>
            </div>
            <label className="ml-auto inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={follow} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFollow(e.target.checked)} />
              Follow playback
            </label>
          </div>
          <div className="text-sm text-muted">{status}</div>
        </div>

        <div className="lg:col-span-5 bg-surface border border-base rounded p-4 space-y-3 max-h-[70vh] overflow-auto">
          <h2 className="font-medium">Transcript</h2>
          <div className="space-y-3">
            {segments.map((s: DisplaySeg, idx: number) => {
              // Use cardKey for active state to uniquely identify chunks
              const cardKey = `${s.id}-chunk-${s.groupIndex ?? 0}`
              const isActive = activeIds.segId === cardKey
              const matchesForSeg: SegmentMatch[] = matchesBySeg.get(s.id) ?? []
              const sortedMatches = matchesForSeg.slice().sort((a: SegmentMatch, b: SegmentMatch) => a.index - b.index)
              let charCursor = 0
              // Use isFirstInGroup from normalizeSegments for header visibility
              const showSpeakerHeader = s.isFirstInGroup
              const sp = s.speaker_id ? speakersMap.get(s.speaker_id) : undefined
              const speakerLabel = sp?.label || 'Unknown'
              const avatarBg = colorForSpeaker(sp)
              const initials = getInitials(speakerLabel)
              return (
                <div
                  key={cardKey}
                  data-testid="segment-card"
                  ref={(node: HTMLDivElement | null) => {
                    if (node) {
                      segmentRefs.current[cardKey] = node
                      if (isActive) activeSegRef.current = node
                    } else {
                      delete segmentRefs.current[cardKey]
                    }
                  }}
                  className={`group rounded p-2 cursor-pointer ${isActive ? 'bg-accent-soft border border-base' : 'hover:bg-surface-alt'}`}
                  onClick={() => onSegmentClick(s.start_ms)}
                >
                  <div className="flex items-start gap-3">
                    {/* Always render avatar container for consistent width, but hide content for non-first cards */}
                    <div className="shrink-0 pt-0.5 w-8">
                      {showSpeakerHeader && (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ backgroundColor: avatarBg }}>
                          {initials}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      {showSpeakerHeader && (
                        <div className="text-[11px] uppercase tracking-wide text-muted mb-1 flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: avatarBg }} />
                          <span>{speakerLabel}</span>
                        </div>
                      )}
                      <div className="text-[11px] text-muted mb-1 flex items-center gap-2">
                        <span>{msToTimestamp(s.start_ms)} — {msToTimestamp(s.end_ms)}</span>
                        <span className="ml-auto text-[11px]">
                          {saveStatus[s.cardKey] === 'saving' && <span className="text-amber-600">Saving…</span>}
                          {saveStatus[s.cardKey] === 'saved' && <span className="text-emerald-600">Saved</span>}
                          {saveStatus[s.cardKey] === 'error' && <span className="text-red-600">Save failed</span>}
                        </span>
                        <button
                          className="text-xs px-2 py-0.5 rounded border border-base hover:bg-surface-alt opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation()
                            setEditingId((prev: string | null) => (prev === s.cardKey ? null : s.cardKey))
                            setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.cardKey]: s.text }))
                          }}
                        >{editingId === s.cardKey ? 'Close' : 'Edit'}</button>
                      </div>
                      {editingId === s.cardKey ? (
                        <div className="text-sm">
                          <textarea
                            ref={(node: HTMLTextAreaElement | null) => {
                              if (node) {
                                textAreaRefs.current[s.cardKey] = node
                              } else {
                                delete textAreaRefs.current[s.cardKey]
                              }
                            }}
                            className="w-full border border-base bg-surface rounded p-2 min-h-[100px] text-current"
                            value={editingTexts[s.cardKey] ?? s.text}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                              const value = e.target.value
                              setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.cardKey]: value }))
                              scheduleSave(s.cardKey, s.id, value)
                            }}
                            onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <div className="text-sm leading-7 break-words">
                          {(s.words && s.words.length ? s.words : [{ key: `${s.id}:0`, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text }]).map((w: Word, wordIdx: number, wordsArr: Word[]) => {
                            const wordText = w.text
                            const wordStart = charCursor
                            const wordEnd = wordStart + wordText.length
                            let content: React.ReactNode
                            const overlapping = sortedMatches.filter((m: SegmentMatch) => m.index < wordEnd && (m.index + m.length) > wordStart)
                            if (overlapping.length === 0) {
                              content = <>{wordText}</>
                            } else {
                              let localPos = 0
                              const pieces: React.ReactNode[] = []
                              overlapping.sort((a: SegmentMatch, b: SegmentMatch) => a.index - b.index).forEach((m: SegmentMatch, idx2: number) => {
                                const startIdx = Math.max(0, m.index - wordStart)
                                const endIdx = Math.min(wordText.length, m.index + m.length - wordStart)
                                if (startIdx > localPos) {
                                  pieces.push(<span key={`n-${m.matchIdx}-${idx2}-${startIdx}`}>{wordText.slice(localPos, startIdx)}</span>)
                                }
                                const highlight = wordText.slice(startIdx, endIdx)
                                pieces.push(
                                  <span key={`h-${m.matchIdx}-${idx2}`} className={`${m.matchIdx === matchIndex ? 'bg-yellow-400 text-black' : 'bg-yellow-200 text-black'}`}>{highlight}</span>
                                )
                                localPos = endIdx
                              })
                              if (localPos < wordText.length) {
                                pieces.push(<span key={`t-${w.key}-${localPos}`}>{wordText.slice(localPos)}</span>)
                              }
                              content = <>{pieces}</>
                            }
                            charCursor = wordEnd + 1 // +1 for the space we're adding
                            // Add space after word (except for last word)
                            const needsSpace = wordIdx < wordsArr.length - 1
                            return (
                              <span key={w.key} onClick={(e: React.MouseEvent<HTMLSpanElement>) => { e.stopPropagation(); onWordClick(w.start_ms) }}>{content}{needsSpace ? ' ' : ''}</span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
