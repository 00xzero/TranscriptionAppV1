"use client"
import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AudioPlayer, { AudioPlayerRef } from '../../../components/AudioPlayer'
import {
  fetchTranscriptData,
  fetchChunks, // Keep for error recovery fallback if needed
  fetchSpeakers,
  fetchProjectById,
  updateChunk,
  updateSegment,
  updateProject,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
} from '../../../lib/supabase/queries'
import type { Chunk, Speaker as SpeakerType, EditorWord } from '../../../lib/supabase/types'
import SpeakerPopover from '../../../components/SpeakerPopover'
import ExportModal from '../../../components/ExportModal'
import FindReplaceModal from '../../../components/FindReplaceModal'
import CollapsibleWaveform from '../../../components/CollapsibleWaveform'
import FloatingPlayerDeck from '../../../components/FloatingPlayerDeck'
import { useAudioSessionRecovery } from '../../../hooks/useAudioSessionRecovery'

type Word = EditorWord
type Seg = Chunk & { words?: Word[] }
type Speaker = SpeakerType
type Match = { segId: string; index: number; length: number }
type SegmentMatch = { index: number; length: number; matchIdx: number }
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SaveStatusBySegment = Record<string, SaveStatus>

const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
const SYNC_OFFSET_MS = 150
const SEEK_LOCK_MS = 3000
const SEEK_RESUME_TIMEOUT_MS = 1000
const SEEK_TOLERANCE_MS = 250
const ASCII_WORD_CHAR_REGEX = /[A-Za-z0-9_]/
// Scripts with little/no case mapping support; used for whole-word boundary checks.
const NON_CASED_WORD_CHAR_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/
const COMBINING_MARK_START = 0x0300
const COMBINING_MARK_END = 0x036f

const isUnicodeWordChar = (char: string) => {
  if (!char) return false
  if (ASCII_WORD_CHAR_REGEX.test(char)) return true
  if (NON_CASED_WORD_CHAR_REGEX.test(char)) return true

  const code = char.charCodeAt(0)
  if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) return true

  // Unicode letters generally have different upper/lower-case transforms.
  return char.toLowerCase() !== char.toUpperCase()
}

const computeWordsForSegment = (seg: { id: string; start_ms: number; end_ms: number; text: string }): Word[] => {
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

const computeWordsForSegments = <T extends { id: string; start_ms: number; end_ms: number; text: string }>(
  items: T[]
): Array<T & { words: Word[] }> => items.map((s) => ({ ...s, words: computeWordsForSegment(s) }))

// Format date as "Oct 24, 2023"
const formatProjectDate = (dateStr: string | null): string => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
}

// Format duration in seconds as "HH:MM:SS"
const formatDurationHHMMSS = (seconds: number | null): string => {
  if (seconds === null || seconds === undefined) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

type SegmentHeaderRowProps = {
  showSpeaker: boolean
  speakerLabel: string
  timestamp: string
  saveStatus: SaveStatusBySegment
  segmentId: string
  segmentText: string
  editingId: string | null
  source: 'chunks' | 'segments'
  onSpeakerClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function SegmentHeaderRow({
  showSpeaker,
  speakerLabel,
  timestamp,
  saveStatus,
  segmentId,
  segmentText,
  editingId,
  source,
  onSpeakerClick,
  setEditingId,
  setEditingTexts,
}: SegmentHeaderRowProps) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      {showSpeaker && onSpeakerClick && (
        <button
          type="button"
          className="font-sans font-bold text-sm text-ink dark:text-[#EAEAEA] cursor-pointer hover:text-trust-blue transition-colors bg-transparent border-0 p-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-blue/40"
          onClick={onSpeakerClick}
          aria-label={`Change speaker (${speakerLabel})`}
          title="Click to change speaker"
        >
          {speakerLabel}
        </button>
      )}
      <span className="font-mono text-[10px] text-ink/40 dark:text-paper/30">{timestamp}</span>
      {/* Save status */}
      <span className="text-[10px] font-mono">
        {saveStatus[segmentId] === 'saving' && <span className="text-trust-blue">Saving…</span>}
        {saveStatus[segmentId] === 'saved' && <span className="text-emerald-600">Saved</span>}
        {saveStatus[segmentId] === 'error' && <span className="text-ember-red">Save failed</span>}
      </span>
      {/* Edit pencil icon */}
      {source !== 'segments' && (
        <button
          className={`ml-auto p-1 rounded-md hover:bg-ink/10 dark:hover:bg-paper/10 transition-opacity ${editingId === segmentId ? 'opacity-100 text-trust-blue' : 'opacity-0 group-hover:opacity-60'}`}
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            setEditingId((prev: string | null) => (prev === segmentId ? null : segmentId))
            setEditingTexts((prev: Record<string, string>) => ({ ...prev, [segmentId]: segmentText }))
          }}
          title={editingId === segmentId ? 'Close editor' : 'Edit text'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function EditorPage({ params }: { params: { id: string } }) {
  const audioPlayerRef = useRef<AudioPlayerRef | null>(null)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [segments, setSegments] = useState<Seg[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const activeSegRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const [syncDirection, setSyncDirection] = useState<'up' | 'down'>('down')
  const [isFollowMode, setIsFollowMode] = useState(true)
  const isUserScrollingRef = useRef(false)
  const [activeIds, setActiveIds] = useState<{ segId?: string; wordKey?: string }>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTexts, setEditingTexts] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<SaveStatusBySegment>({})
  const saveTimers = useRef<Record<string, number>>({})
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [findInput, setFindInput] = useState('')
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [speakerPopover, setSpeakerPopover] = useState<{ chunkId: string; speakerId: string | null; anchorRect: DOMRect } | null>(null)
  const [projectTitle, setProjectTitle] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isSavingTitleRef = useRef(false)
  const [source, setSource] = useState<'chunks' | 'segments'>('chunks')
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [waveformCollapsed, setWaveformCollapsed] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | null>(null)
  const [projectDurationSecs, setProjectDurationSecs] = useState<number | null>(null)
  // Ref to prevent timeupdate/audioprocess from overriding manual card clicks
  const clickLockRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const seekTokenRef = useRef(0)
  const seekTimeoutRef = useRef<number | null>(null)

  const openFindReplaceModal = useCallback(() => {
    if (exportModalOpen) return
    // Auto-exit transcript text edit mode when entering find/replace.
    setEditingId(null)
    setSpeakerPopover(null)
    setFindReplaceOpen(true)
  }, [exportModalOpen])

  const openExportModal = useCallback(() => {
    if (findReplaceOpen) setFindReplaceOpen(false)
    setEditingId(null)
    setSpeakerPopover(null)
    setExportModalOpen(true)
  }, [findReplaceOpen])

  const handleAudioPlayerRef = useCallback((player: AudioPlayerRef | null) => {
    audioPlayerRef.current = player
    setAudioElement(player?.getAudioElement?.() ?? null)
  }, [])

  // Session recovery: refresh audio URL when returning to tab after idle
  useAudioSessionRecovery({
    projectId: params.id,
    audioSrc,
    audioElement,
    onUrlRefreshed: (newUrl) => {
      setAudioSrc(newUrl)
    },
    onRecoveryError: (error) => {
      console.warn('[Editor] Audio recovery failed:', error)
    },
  })

  // Listen for header button custom events
  useEffect(() => {
    window.addEventListener('open-find-replace', openFindReplaceModal)
    window.addEventListener('open-export', openExportModal)
    return () => {
      window.removeEventListener('open-find-replace', openFindReplaceModal)
      window.removeEventListener('open-export', openExportModal)
    }
  }, [openFindReplaceModal, openExportModal])

  const seekToMs = useCallback((targetMs: number, { skipLock = false }: { skipLock?: boolean } = {}) => {
    const player = audioPlayerRef.current
    if (!player) return

    if (!readyRef.current) {
      pendingSeekRef.current = targetMs
      return
    }

    if (!skipLock) {
      // Set click lock to prevent sync overriding manual seeks (e.g. transcript card clicks)
      clickLockRef.current = Date.now() + SEEK_LOCK_MS
    } else {
      // Clear any existing lock so transcript syncs immediately
      clickLockRef.current = null
    }

    // Delegate to AudioPlayer's seekToMs
    player.seekToMs(targetMs)
  }, [])


  // Helper to find and set active segment based on time in ms
  const syncActiveSegment = useCallback((tMs: number) => {
    // Guard: Don't update if segments aren't loaded yet
    if (segmentsRef.current.length === 0) return

    // Guard: Skip if click lock is active (prevents overriding manual clicks)
    if (clickLockRef.current && Date.now() < clickLockRef.current) {
      return
    }

    const tAdj = Math.max(0, tMs - SYNC_OFFSET_MS)
    let segId: string | undefined
    for (const s of segmentsRef.current) {
      if (tAdj >= s.start_ms && tAdj <= s.end_ms) {
        segId = s.id
        break
      }
    }
    // Only update if we found a segment (prevents clearing activeIds prematurely)
    if (segId) {
      setActiveIds({ segId, wordKey: undefined })
    }
  }, [])

  // AudioPlayer callback handlers
  const handleAudioReady = useCallback(() => {
    readyRef.current = true
    setReady(true)
    setStatus('Ready')
    const player = audioPlayerRef.current
    const currentTime = player?.getCurrentTime?.() ?? 0
    const dur = player?.getDuration?.() ?? 0
    setAudioCurrentTime(currentTime)
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
    const pendingSeekMs = pendingSeekRef.current
    if (pendingSeekMs !== null) {
      pendingSeekRef.current = null
      seekToMs(pendingSeekMs)
    }
  }, [seekToMs])

  const handleAudioError = useCallback((error: string) => {
    setStatus(`Error: ${error}`)
  }, [])

  const handlePlayingChange = useCallback((isPlaying: boolean) => {
    setPlaying(isPlaying)
  }, [])

  const handleTimeUpdate = useCallback((currentTime: number) => {
    syncActiveSegment(Math.floor(currentTime * 1000))
    setAudioCurrentTime(currentTime)
    const player = audioPlayerRef.current
    const dur = player?.getDuration?.() || 0
    setAudioDuration(dur)
    setAudioProgress(dur > 0 ? (currentTime / dur) * 100 : 0)
  }, [syncActiveSegment])

  // Collapse waveform when transcript scrolls past 50px
  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) return
    const handleScroll = () => {
      setWaveformCollapsed(container.scrollTop > 50)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Data loading effect - simpler now that AudioPlayer handles audio
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        setStatus('Loading media...')
        setReady(false)
        readyRef.current = false

        // Fetch the media URL
        const res = await fetch(`/api/projects/${params.id}/media-url`)
        if (!res.ok) throw new Error(`Failed to fetch media URL: ${res.status}`)
        const j = await res.json()
        const url: string = j.url

        if (cancelled) return
        setAudioSrc(url)

        // Load transcript data (chunks or segments)
        const { items: segs, source: dataSource } = await fetchTranscriptData(params.id)
        if (!cancelled) {
          setSource(dataSource)
          // Derive approximate word timings if not provided
          setSegments(computeWordsForSegments(segs) as Seg[])
        }

        // Load speakers from Supabase
        try {
          const sps = await fetchSpeakers(params.id)
          if (!cancelled) {
            setSpeakers(sps)
          }
        } catch (_) { /* ignore */ }

        // Load project metadata from Supabase
        try {
          const projData = await fetchProjectById(params.id)
          if (!cancelled && projData) {
            setProjectTitle(projData.title || null)
            setProjectCreatedAt(projData.created_at)
            setProjectDurationSecs(projData.duration_seconds)
          }
        } catch (_) { /* ignore */ }

      } catch (e: any) {
        console.error(e)
        setStatus(`Error: ${e.message || e}`)
      }
    }
    init()
    return () => {
      cancelled = true
      if (seekTimeoutRef.current) {
        window.clearTimeout(seekTimeoutRef.current)
        seekTimeoutRef.current = null
      }
      readyRef.current = false
    }
  }, [params.id])

  const togglePlay = useCallback(() => {
    const player = audioPlayerRef.current
    if (!player) return
    player.togglePlay()
  }, [])

  const seekRelative = useCallback((sec: number) => {
    const player = audioPlayerRef.current
    if (!player) return
    player.seekRelative(sec)
  }, [])

  // Keep a ref to latest segments to use inside WS callbacks
  const segmentsRef = useRef(segments)
  useEffect(() => { segmentsRef.current = segments }, [segments])

  // Detect if transcript is out of sync with audio playback
  useEffect(() => {
    if (speakerPopover) return // Skip detection while popover is open
    const container = transcriptScrollRef.current
    if (!container || !activeIds.segId) {
      return
    }

    const checkSync = () => {
      // Get activeEl fresh each time since it changes as audio plays
      const activeEl = activeSegRef.current
      if (!activeEl) {
        return
      }

      const containerRect = container.getBoundingClientRect()
      const activeRect = activeEl.getBoundingClientRect()

      // Determine direction: if active is above viewport, need to scroll up
      setSyncDirection(activeRect.top < containerRect.top ? 'up' : 'down')
    }

    // Handle user scroll - disable follow mode when user scrolls manually
    const handleUserScroll = () => {
      if (isUserScrollingRef.current) {
        setIsFollowMode(false)
      }
      checkSync()
    }

    // Detect user-initiated scroll vs programmatic scroll
    const handleWheel = () => { isUserScrollingRef.current = true }
    const handleTouchStart = () => { isUserScrollingRef.current = true }
    let scrollEndTimer: number | undefined
    const handleScrollEnd = () => {
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer)
      scrollEndTimer = window.setTimeout(() => { isUserScrollingRef.current = false }, 100)
    }

    checkSync()
    container.addEventListener('scroll', handleUserScroll)
    container.addEventListener('scroll', handleScrollEnd)
    container.addEventListener('wheel', handleWheel)
    container.addEventListener('touchstart', handleTouchStart)
    // Also check periodically as audio plays and active segment changes
    const interval = setInterval(checkSync, 300)
    return () => {
      container.removeEventListener('scroll', handleUserScroll)
      container.removeEventListener('scroll', handleScrollEnd)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer)
      clearInterval(interval)
    }
  }, [activeIds.segId, speakerPopover])

  // Auto-scroll to active segment when in follow mode
  useEffect(() => {
    if (!isFollowMode || !activeIds.segId) return
    const activeEl = activeSegRef.current
    if (activeEl) {
      isUserScrollingRef.current = false // Mark as programmatic scroll
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeIds.segId, isFollowMode])

  // Turn off follow mode when user starts editing
  useEffect(() => {
    if (editingId) {
      setIsFollowMode(false)
    }
  }, [editingId])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isEditableTarget =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      const isAltGraph =
        e.getModifierState?.('AltGraph') ||
        (e.ctrlKey && e.altKey && !e.metaKey)

      // Cmd/Ctrl+F opens Find/Replace — intercept before the input guard
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFindReplaceModal()
        return
      }
      // Cmd/Ctrl+E opens Export modal
      if (!isEditableTarget && !e.altKey && !isAltGraph && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        openExportModal()
        return
      }
      if (isEditableTarget) return
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return }
      if (e.key.toLowerCase() === 'j') { seekRelative(-2); return }
      if (e.key.toLowerCase() === 'l') { seekRelative(2); return }
      if (e.key === ',') { seekRelative(-0.25); return }
      if (e.key === '.') { seekRelative(0.25); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekRelative, openFindReplaceModal, openExportModal])

  const onWordClick = (ms: number) => {
    seekToMs(ms)
  }

  // Direct segment click - set activeIds immediately without time-based lookup
  const onSegmentClick = (segId: string, ms: number) => {
    setActiveIds({ segId, wordKey: undefined })
    seekToMs(ms)
  }

  const onRateChange = (r: number) => {
    setPlaybackRate(r)
    const player = audioPlayerRef.current
    if (player) player.setPlaybackRate(r)
  }

  const scheduleSave = useCallback((segId: string, newText: string) => {
    if (source === 'segments') return

    // update UI immediately
    setSegments((prev: Seg[]) => prev.map((s: Seg) => s.id === segId ? { ...s, text: newText, words: computeWordsForSegment({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, text: newText }) } : s))
    setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'saving' }))

    // clear existing timer
    const t = saveTimers.current[segId]
    if (t) { window.clearTimeout(t); delete saveTimers.current[segId] }

    // debounce before saving
    const timerId = window.setTimeout(async () => {
      try {
        await updateChunk(segId, { text: newText })
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'saved' }))
        // reset saved flag after a moment
        window.setTimeout(() => setSaveStatus((p: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...p, [segId]: 'idle' })), 1200)
      } catch (e) {
        console.error('save failed', e)
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'error' }))
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current[segId] = timerId
  }, [source])

  const matches = useMemo<Match[]>(() => {
    if (!findTerm) return []
    const needle = caseSensitive ? findTerm : findTerm.toLowerCase()
    if (!needle.length) return []
    const found: Match[] = []
    for (const seg of segments) {
      const text = editingTexts[seg.id] ?? seg.text ?? ''
      const haystack = caseSensitive ? text : text.toLowerCase()
      let start = 0
      while (true) {
        const idx = haystack.indexOf(needle, start)
        if (idx === -1) break
        if (wholeWord) {
          const before = idx > 0 ? haystack[idx - 1] : ''
          const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : ''
          if ((before && isUnicodeWordChar(before)) || (after && isUnicodeWordChar(after))) {
            start = idx + Math.max(needle.length, 1)
            continue
          }
        }
        found.push({ segId: seg.id, index: idx, length: needle.length })
        start = idx + Math.max(needle.length, 1)
      }
    }
    return found
  }, [segments, editingTexts, findTerm, caseSensitive, wholeWord])

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

  const speakerColorPalette = useMemo(() => [
    // First 3 colors match Olivetti prototype exactly
    '#4F638C', // trust-blue (Speaker 0)
    '#C73E1D', // ember-red (Speaker 1)
    '#CA8A04', // warm amber/yellow-600 (Speaker 2)
    // Additional brand-complementary colors for more speakers
    '#0D9488', // teal-600 - calm, professional
    '#7C3AED', // violet-600 - creative, distinct
    '#64748B', // slate-500 - neutral, readable
    '#B45309', // amber-700 - warm, earthy
    '#059669', // emerald-600 - fresh, natural
    '#DB2777', // pink-600 - vibrant accent
    '#2563EB', // blue-600 - classic, trustworthy
  ], [])

  const speakerColorMap = useMemo(() => {
    const map = new Map<string, string>()
    speakers.forEach((sp, idx) => {
      if (sp.color) {
        map.set(sp.id, sp.color)
      } else {
        map.set(sp.id, speakerColorPalette[idx % speakerColorPalette.length])
      }
    })
    return map
  }, [speakers, speakerColorPalette])

  const colorForSpeaker = useCallback((sp?: Speaker) => {
    if (!sp) return '#9CA3AF'
    if (sp.color) return sp.color
    return speakerColorMap.get(sp.id) || '#9CA3AF'
  }, [speakerColorMap])

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
  }, [findTerm, caseSensitive, wholeWord])

  useEffect(() => {
    if (!currentMatch) return
    const seg = segments.find((s: Seg) => s.id === currentMatch.segId)
    if (!seg) return

    const card = segmentRefs.current[seg.id]
    try {
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (_) { /* noop */ }
  }, [currentMatch, segments])

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
    const seg = segments.find((s: Seg) => s.id === currentMatch.segId)
    if (!seg) return
    const text = editingTexts[seg.id] ?? seg.text ?? ''
    const before = text.slice(0, currentMatch.index)
    const after = text.slice(currentMatch.index + currentMatch.length)
    const updated = before + replaceTerm + after
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, [seg.id]: updated }))
    scheduleSave(seg.id, updated)
    handleNext()
  }, [currentMatch, segments, editingTexts, replaceTerm, scheduleSave, handleNext])

  const handleReplaceAll = useCallback(() => {
    if (!totalMatches) return
    const baseTexts: Record<string, string> = {}
    segments.forEach((seg: Seg) => {
      baseTexts[seg.id] = editingTexts[seg.id] ?? seg.text ?? ''
    })
    const shifts: Record<string, number> = {}
    const updatedTexts: Record<string, string> = {}

    matches.forEach((match: Match) => {
      const segId = match.segId
      const prior = updatedTexts[segId] ?? baseTexts[segId]
      const shift = shifts[segId] ?? 0
      const idx = match.index + shift
      const before = prior.slice(0, idx)
      const after = prior.slice(idx + match.length)
      const updated = before + replaceTerm + after
      updatedTexts[segId] = updated
      shifts[segId] = shift + replaceTerm.length - match.length
    })

    if (Object.keys(updatedTexts).length === 0) return
    setEditingTexts((prev: Record<string, string>) => ({ ...prev, ...updatedTexts }))
    Object.entries(updatedTexts).forEach(([segId, text]) => scheduleSave(segId, text))
  }, [totalMatches, matches, segments, editingTexts, replaceTerm, scheduleSave])

  // Debounce findInput into findTerm after 800ms of inactivity
  useEffect(() => {
    if (!findInput.trim()) {
      setFindTerm('')
      return
    }
    const timer = setTimeout(() => {
      setFindTerm(findInput)
    }, 800)
    return () => clearTimeout(timer)
  }, [findInput])

  const onFindKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // First Enter on a new term commits it; second Enter selects current result.
    if (findInput !== findTerm) {
      setFindTerm(findInput)
      return
    }
    if (totalMatches > 0) {
      setFindReplaceOpen(false)
    }
  }, [findInput, findTerm, totalMatches])

  const hasMatches = totalMatches > 0
  const isFindDirty = findInput !== findTerm
  const canNavigate = hasMatches && !isFindDirty
  const matchSummary = isFindDirty
    ? 'Searching...'
    : totalMatches
      ? `${matchIndex + 1} of ${totalMatches} matches`
      : (findTerm ? '0 matches' : '')

  // Speaker popover handlers
  const handleAvatarClick = useCallback((e: React.MouseEvent, chunkId: string, speakerId: string | null) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setSpeakerPopover({ chunkId, speakerId, anchorRect: rect })
  }, [])

  const handleSelectSpeaker = useCallback(async (speaker: Speaker) => {
    if (!speakerPopover) return
    const { chunkId } = speakerPopover

    // Optimistic update
    setSegments(prev => prev.map(s => s.id === chunkId ? { ...s, speaker_id: speaker.id } : s))
    setSpeakerPopover(null)

    try {
      if (source === 'segments') {
        await updateSegment(chunkId, { speaker_id: speaker.id })
      } else {
        await updateChunk(chunkId, { speaker_id: speaker.id })
      }
    } catch (err) {
      console.error('Failed to reassign speaker:', err)
      // Revert on error - reload segments
      const { items: segs } = await fetchTranscriptData(params.id)
      setSegments(computeWordsForSegments(segs) as Seg[])
    }
  }, [speakerPopover, params.id, source])

  const handleCreateSpeaker = useCallback(async (label: string) => {
    if (!speakerPopover) return
    const { chunkId } = speakerPopover

    setSpeakerPopover(null)

    let newSpeaker: Speaker | null = null

    try {
      // Create new speaker
      const createdSpeaker = await createSpeaker(params.id, label)
      newSpeaker = createdSpeaker

      // Reassign chunk/segment to new speaker
      if (source === 'segments') {
        await updateSegment(chunkId, { speaker_id: createdSpeaker.id })
      } else {
        await updateChunk(chunkId, { speaker_id: createdSpeaker.id })
      }

      // Both succeeded - now update state
      setSpeakers(prev => [...prev, createdSpeaker])
      setSegments(prev => prev.map(s => s.id === chunkId ? { ...s, speaker_id: createdSpeaker.id } : s))
    } catch (err) {
      console.error('Failed to create speaker:', err)

      // Rollback: if speaker was created but chunk patch failed, delete the orphan speaker
      if (newSpeaker) {
        try {
          await deleteSpeaker(newSpeaker.id)
        } catch (cleanupErr) {
          console.error('Failed to cleanup orphan speaker:', cleanupErr)
        }
      }
    }
  }, [speakerPopover, params.id, source])

  const handleRenameSpeaker = useCallback(async (speaker: Speaker, newLabel: string) => {
    // Optimistic update
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    setSpeakerPopover(null)

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to rename speaker:', err)
      // Revert on error
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [])

  const handleUntag = useCallback(async (speaker: Speaker) => {
    // Find next available "Speaker X" number
    const existingNumbers = speakers
      .map(sp => {
        const match = sp.label.match(/^Speaker\s+(\d+)$/i)
        return match ? parseInt(match[1], 10) : -1
      })
      .filter(n => n >= 0)
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 0
    const newLabel = `Speaker ${nextNumber}`

    // Optimistic update
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    setSpeakerPopover(null)

    try {
      await updateSpeaker(speaker.id, { label: newLabel })
    } catch (err) {
      console.error('Failed to untag speaker:', err)
      // Revert on error
      setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: speaker.label } : sp))
    }
  }, [speakers])

  const currentPopoverSpeaker = useMemo(() => {
    if (!speakerPopover?.speakerId) return undefined
    return speakers.find(sp => sp.id === speakerPopover.speakerId)
  }, [speakerPopover, speakers])

  const startEditingTitle = useCallback(() => {
    setTitleInput(projectTitle || '')
    setTitleSaveError(null)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [projectTitle])

  const saveTitle = useCallback(async () => {
    if (isSavingTitleRef.current) return

    const newTitle = titleInput.trim()
    if (!newTitle) {
      setEditingTitle(false)
      setTitleSaveError(null)
      return
    }

    isSavingTitleRef.current = true
    setTitleSaveError(null)

    try {
      await updateProject(params.id, { title: newTitle })
      setProjectTitle(newTitle)
      setEditingTitle(false)
    } catch (err) {
      console.error('Failed to save title:', err)
      setTitleSaveError('Failed to save title. Please try again.')
    } finally {
      isSavingTitleRef.current = false
    }
  }, [titleInput, params.id])

  const onTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditingTitle(false)
      setTitleSaveError(null)
    }
  }, [saveTitle])

  const onTitleBlur = useCallback(() => {
    if (isSavingTitleRef.current) return
    saveTitle()
  }, [saveTitle])


  const uniqueSpeakerCount = useMemo(() => {
    const ids = new Set(segments.map(s => s.speaker_id).filter(Boolean))
    return ids.size
  }, [segments])
  const showStatusInMetaRow = status !== 'Ready'
  const isStatusError = status.startsWith('Error:')

  return (
    <div className="flex flex-col h-full relative">
      {/* Collapsible Waveform — at the top */}
      <CollapsibleWaveform
        collapsed={waveformCollapsed}
        audioProgress={audioProgress}
        onExpandClick={() => {
          setIsFollowMode(false)
          setWaveformCollapsed(false)
          transcriptScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onScrub={(fraction) => seekToMs(fraction * audioDuration * 1000, { skipLock: true })}
      >
        {audioSrc ? (
          <AudioPlayer
            ref={handleAudioPlayerRef}
            src={audioSrc}
            onReady={handleAudioReady}
            onError={handleAudioError}
            onPlayingChange={handlePlayingChange}
            onTimeUpdate={handleTimeUpdate}
            initialPlaybackRate={playbackRate}
            hideControls
          />
        ) : (
          <div className="h-12 flex items-center justify-center text-muted">
            Loading audio...
          </div>
        )}
      </CollapsibleWaveform>

      {/* Find/Replace Modal */}
      <FindReplaceModal
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        findInput={findInput}
        setFindInput={setFindInput}
        findTerm={findTerm}
        replaceTerm={replaceTerm}
        setReplaceTerm={setReplaceTerm}
        caseSensitive={caseSensitive}
        setCaseSensitive={setCaseSensitive}
        wholeWord={wholeWord}
        setWholeWord={setWholeWord}
        onNext={handleNext}
        onPrev={handlePrev}
        onReplace={handleReplace}
        onReplaceAll={handleReplaceAll}
        onFindKeyDown={onFindKeyDown}
        onClear={() => {
          setFindInput('')
          setFindTerm('')
          setReplaceTerm('')
          setMatchIndex(0)
          setCaseSensitive(false)
          setWholeWord(false)
        }}
        matchSummary={matchSummary}
        canNavigate={canNavigate}
        canReplace={source !== 'segments'}
        hasMatches={hasMatches}
        matches={matches}
        segments={segments}
        matchIndex={matchIndex}
        onMatchClick={(idx: number) => setMatchIndex(idx)}
      />

      {/* Mix mode warning - collapse in sync with waveform */}
      {source === 'segments' && (
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${waveformCollapsed ? 'max-h-0 opacity-0 my-0' : 'max-h-32 opacity-100 my-3'
            }`}
        >
          <div className="mx-6 bg-warm-highlight/30 dark:bg-warm-highlight/10 border border-ink/10 dark:border-paper/10 rounded-lg p-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-ink/60 dark:text-paper/60 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-ink dark:text-paper">Mix Mode (Raw Segments)</h3>
              <p className="text-sm text-muted mt-1">
                Text editing is disabled because consolidation was skipped, but you can assign speakers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content Area — Document Header + Transcript */}
      <div className={`flex-1 overflow-auto pb-32 ${waveformCollapsed ? 'pt-[56px]' : 'pt-0'}`} ref={transcriptScrollRef}>
        {/* Document Header — scrolls with content */}
        <div className="px-6 md:px-20 pt-10 pb-6">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  className={`font-serif italic text-4xl md:text-5xl tracking-tight bg-transparent border-b-2 px-1 py-0.5 text-ink dark:text-[#EAEAEA] min-w-[300px] focus:outline-none ${titleSaveError ? 'border-ember-red' : 'border-trust-blue'}`}
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={onTitleKeyDown}
                  onBlur={onTitleBlur}
                  placeholder="Project title"
                />
              ) : (
                <h1
                  className="font-serif italic text-4xl md:text-5xl tracking-tight text-ink dark:text-[#EAEAEA] cursor-pointer hover:text-trust-blue transition-colors mb-4"
                  onClick={startEditingTitle}
                  title="Click to edit title"
                >
                  {projectTitle || `Untitled (${params.id.slice(0, 8)}...)`}
                </h1>
              )}
            </div>
            {titleSaveError && (
              <span className="text-sm text-ember-red">{titleSaveError}</span>
            )}
            <div className="flex items-center gap-4 text-xs font-mono uppercase tracking-wider text-ink/50 dark:text-paper/40">
              {showStatusInMetaRow ? (
                <span className={isStatusError ? 'text-ember-red/90 dark:text-ember-red/90' : ''}>
                  {status}
                </span>
              ) : (
                <>
                  {projectCreatedAt && (
                    <>
                      <span>{formatProjectDate(projectCreatedAt)}</span>
                      <span>•</span>
                    </>
                  )}
                  <span>{uniqueSpeakerCount} speaker{uniqueSpeakerCount !== 1 ? 's' : ''}</span>
                  {projectDurationSecs !== null && (
                    <>
                      <span>•</span>
                      <span>{formatDurationHHMMSS(projectDurationSecs)}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="h-px w-full bg-ink/10 dark:bg-white/10 mt-8" />
        </div>

        {/* Transcript cards */}
        <div className="px-6 md:px-20 max-w-5xl mx-auto space-y-1">
          {segments.map((s: Seg, idx: number) => {
            const isActive = activeIds.segId === s.id
            const matchesForSeg: SegmentMatch[] = matchesBySeg.get(s.id) ?? []
            const sortedMatches = matchesForSeg.slice().sort((a: SegmentMatch, b: SegmentMatch) => a.index - b.index)
            let charCursor = 0
            const prevSpeakerId = idx > 0 ? (segments[idx - 1]?.speaker_id ?? null) : null
            const needHeader = idx === 0 || (s.speaker_id ?? null) !== prevSpeakerId
            const sp = s.speaker_id ? speakersMap.get(s.speaker_id) : undefined
            const speakerLabel = sp?.label || 'Unknown'
            const avatarBg = colorForSpeaker(sp)
            const initials = getInitials(speakerLabel)
            return (
              <div
                key={s.id}
                data-testid="segment-card"
                ref={(node: HTMLDivElement | null) => {
                  if (node) {
                    segmentRefs.current[s.id] = node
                    if (isActive) activeSegRef.current = node
                  } else {
                    delete segmentRefs.current[s.id]
                  }
                }}
                className={`group rounded-xl cursor-pointer flex gap-3 transition-colors ${needHeader ? 'p-3 mt-4' : 'py-2 px-3'} ${isActive ? 'bg-trust-blue/10 dark:bg-trust-blue/15' : 'hover:bg-ink/5 dark:hover:bg-white/5'}`}
                onClick={() => onSegmentClick(s.id, s.start_ms)}
              >
                {/* Vertical color bar */}
                <div
                  className={`shrink-0 self-stretch rounded-full transition-all ${isActive ? 'w-1.5 shadow-sm' : 'w-1 opacity-60'}`}
                  style={{ backgroundColor: avatarBg }}
                />

                <div className="flex-1 min-w-0">
                  <SegmentHeaderRow
                    showSpeaker={needHeader}
                    speakerLabel={speakerLabel}
                    timestamp={msToTimestamp(s.start_ms)}
                    saveStatus={saveStatus}
                    segmentId={s.id}
                    segmentText={s.text}
                    editingId={editingId}
                    source={source}
                    onSpeakerClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation()
                      handleAvatarClick(e, s.id, s.speaker_id ?? null)
                    }}
                    setEditingId={setEditingId}
                    setEditingTexts={setEditingTexts}
                  />
                  {editingId === s.id ? (
                    <div>
                      <textarea
                        ref={(node: HTMLTextAreaElement | null) => {
                          if (node) {
                            textAreaRefs.current[s.id] = node
                          } else {
                            delete textAreaRefs.current[s.id]
                          }
                        }}
                        className="w-full border border-ink/10 dark:border-paper/10 bg-surface rounded-md p-2 min-h-[100px] text-current text-base leading-relaxed"
                        value={editingTexts[s.id] ?? s.text}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                          const value = e.target.value
                          setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.id]: value }))
                          scheduleSave(s.id, value)
                        }}
                        onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => e.stopPropagation()}
                      />
                    </div>
                  ) : (
                    <div className="font-sans text-lg leading-relaxed text-ink/90 dark:text-paper/80">
                      {(s.words && s.words.length ? s.words : [{ key: `${s.id}:0`, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text }]).map((w: Word) => {
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
                              <span key={`h-${m.matchIdx}-${idx2}`} className={`${m.matchIdx === matchIndex ? 'bg-warm-highlight text-ink outline outline-2 outline-ember-red dark:bg-trust-blue dark:text-white dark:outline-ember-red' : 'bg-warm-highlight text-ink dark:bg-trust-blue dark:text-white'}`}>{highlight}</span>
                            )
                            localPos = endIdx
                          })
                          if (localPos < wordText.length) {
                            pieces.push(<span key={`t-${w.key}-${localPos}`}>{wordText.slice(localPos)}</span>)
                          }
                          content = <>{pieces}</>
                        }
                        charCursor = wordEnd
                        return (
                          <span key={w.key} onClick={(e: React.MouseEvent<HTMLSpanElement>) => { e.stopPropagation(); onWordClick(w.start_ms) }}>{content}</span>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Floating sync button — glassmorphism style */}
      {!isFollowMode && activeIds.segId && !speakerPopover && !editingId && (
        <button
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-white/60 dark:bg-black/60 backdrop-blur-md text-ink dark:text-paper border border-ink/10 dark:border-paper/10 rounded-2xl shadow-float flex items-center gap-2 hover:bg-white/80 dark:hover:bg-black/80 transition-colors"
          onClick={() => {
            isUserScrollingRef.current = false
            setIsFollowMode(true)
            activeSegRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }}
        >
          {syncDirection === 'up' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          )}
          Sync to audio
        </button>
      )}

      {/* Floating Player Deck */}
      <FloatingPlayerDeck
        currentTime={audioCurrentTime}
        duration={audioDuration}
        playing={playing}
        playbackRate={playbackRate}
        onTogglePlay={togglePlay}
        onSeekRelative={seekRelative}
        onRateChange={onRateChange}
      />

      {/* Export Modal */}
      {exportModalOpen && (
        <ExportModal
          projectId={params.id}
          projectTitle={projectTitle}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      {/* Speaker Popover */}
      {speakerPopover && (
        <SpeakerPopover
          speakers={speakers}
          currentSpeaker={speakerPopover.speakerId ? speakers.find(s => s.id === speakerPopover.speakerId) : undefined}
          anchorRect={speakerPopover.anchorRect}
          onSelectSpeaker={handleSelectSpeaker}
          onCreateSpeaker={handleCreateSpeaker}
          onRenameSpeaker={handleRenameSpeaker}
          onUntag={handleUntag}
          onClose={() => setSpeakerPopover(null)}
          getColorForSpeaker={colorForSpeaker}
        />
      )}
    </div>
  )
}

function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
