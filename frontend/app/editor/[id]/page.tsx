"use client"
import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { getApiBase, getAuthHeaders } from '../../../lib/api'
import SpeakerPopover from '../../../components/SpeakerPopover'

type Word = { key: string; start_ms: number; end_ms: number; text: string }
type Seg = { id: string; start_ms: number; end_ms: number; text: string; speaker_id?: string | null; words?: Word[]; is_edited?: boolean; is_filler?: boolean }
type Speaker = { id: string; project_id: string; label: string; color?: string | null }
type Match = { segId: string; index: number; length: number }
type SegmentMatch = { index: number; length: number; matchIdx: number }

const SAVE_DEBOUNCE_MS = (typeof process !== 'undefined' && process.env.JEST_WORKER_ID) ? 10 : 500
const SYNC_OFFSET_MS = 150

export default function EditorPage({ params }: { params: { id: string } }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [segments, setSegments] = useState<Seg[]>([])
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
  const [speakerPopover, setSpeakerPopover] = useState<{ chunkId: string; speakerId: string | null; anchorRect: DOMRect } | null>(null)


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

        // Load chunks (consolidated segments)
        const segRes = await fetch(`${base}/projects/${params.id}/chunks`, {
          headers: getAuthHeaders(),
        })
        if (!cancelled && segRes.ok) {
          const segs = await segRes.json()
          // Derive approximate word timings if not provided
          const withWords = (segs as any[]).map((s: Seg) => {
            const duration = Math.max(1, (s.end_ms - s.start_ms))
            const tokens = String(s.text || '').split(/(\s+)/).filter(Boolean)
            const words: Word[] = []
            let cursor = 0
            const per = Math.floor(duration / Math.max(1, tokens.filter(t => !/^\s+$/.test(t)).length))
            for (let i = 0; i < tokens.length; i++) {
              const t = tokens[i]
              if (/^\s+$/.test(t)) {
                // whitespace: attach to previous word visually
                if (words.length > 0) words[words.length - 1].text += t
                continue
              }
              const start = s.start_ms + cursor
              const end = i === tokens.length - 1 ? s.end_ms : Math.min(s.end_ms, start + per)
              cursor += per
              words.push({ key: `${s.id}:${i}`, start_ms: start, end_ms: end, text: t })
            }
            return { ...s, words }
          })
          setSegments(withWords)
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
          let segId: string | undefined
          for (const s of segmentsRef.current) {
            if (tAdj >= s.start_ms && tAdj <= s.end_ms) {
              segId = s.id
              break
            }
          }
          setActiveIds({ segId, wordKey: undefined })
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

  const scheduleSave = useCallback((segId: string, newText: string) => {
    // update UI immediately
    setSegments((prev: Seg[]) => prev.map((s: Seg) => s.id === segId ? { ...s, text: newText, words: recomputeWords({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, text: newText }) } : s))
    setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'saving' }))

    // clear existing timer
    const t = saveTimers.current[segId]
    if (t) { window.clearTimeout(t); delete saveTimers.current[segId] }

    // debounce before saving
    const timerId = window.setTimeout(async () => {
      try {
        const res = await fetch(`${getApiBase()}/chunks/${segId}`, {
          method: 'PATCH',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText }),
        })
        if (!res.ok) throw new Error(String(res.status))
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'saved' }))
        // reset saved flag after a moment
        window.setTimeout(() => setSaveStatus((p: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...p, [segId]: 'idle' })), 1200)
      } catch (e) {
        console.error('save failed', e)
        setSaveStatus((prev: Record<string, 'idle' | 'saving' | 'saved' | 'error'>) => ({ ...prev, [segId]: 'error' }))
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current[segId] = timerId
  }, [])

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
        found.push({ segId: seg.id, index: idx, length: needle.length })
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
      const res = await fetch(`${getApiBase()}/chunks/${chunkId}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker_id: speaker.id }),
      })
      if (!res.ok) throw new Error(`Failed to reassign speaker: ${res.status}`)
    } catch (err) {
      console.error('Failed to reassign speaker:', err)
      // Revert on error - reload segments
      const segRes = await fetch(`${getApiBase()}/projects/${params.id}/chunks`, { headers: getAuthHeaders() })
      if (segRes.ok) setSegments(await segRes.json())
    }
  }, [speakerPopover, params.id])

  const handleCreateSpeaker = useCallback(async (label: string) => {
    if (!speakerPopover) return
    const { chunkId } = speakerPopover
    
    setSpeakerPopover(null)
    
    try {
      // Create new speaker
      const createRes = await fetch(`${getApiBase()}/projects/${params.id}/speakers`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!createRes.ok) throw new Error(`Failed to create speaker: ${createRes.status}`)
      const newSpeaker: Speaker = await createRes.json()
      
      // Add to speakers list
      setSpeakers(prev => [...prev, newSpeaker])
      
      // Reassign chunk to new speaker
      const patchRes = await fetch(`${getApiBase()}/chunks/${chunkId}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker_id: newSpeaker.id }),
      })
      if (!patchRes.ok) throw new Error(`Failed to reassign chunk: ${patchRes.status}`)
      
      // Update segment
      setSegments(prev => prev.map(s => s.id === chunkId ? { ...s, speaker_id: newSpeaker.id } : s))
    } catch (err) {
      console.error('Failed to create speaker:', err)
    }
  }, [speakerPopover, params.id])

  const handleRenameSpeaker = useCallback(async (speaker: Speaker, newLabel: string) => {
    // Optimistic update
    setSpeakers(prev => prev.map(sp => sp.id === speaker.id ? { ...sp, label: newLabel } : sp))
    setSpeakerPopover(null)
    
    try {
      const res = await fetch(`${getApiBase()}/speakers/${speaker.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel }),
      })
      if (!res.ok) throw new Error(`Failed to rename speaker: ${res.status}`)
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
      const res = await fetch(`${getApiBase()}/speakers/${speaker.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel }),
      })
      if (!res.ok) throw new Error(`Failed to untag speaker: ${res.status}`)
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
                  className={`rounded p-2 cursor-pointer ${isActive ? 'bg-accent-soft border border-base' : 'hover:bg-surface-alt'}`}
                  onClick={() => onSegmentClick(s.start_ms)}
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 pt-0.5">
                      <button
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white hover:ring-2 hover:ring-offset-1 hover:ring-accent transition-shadow"
                        style={{ backgroundColor: avatarBg }}
                        onClick={(e) => handleAvatarClick(e, s.id, s.speaker_id ?? null)}
                        title="Click to change speaker"
                      >
                        {initials}
                      </button>
                    </div>
                    <div className="flex-1">
                      {needHeader && (
                        <div className="text-[11px] uppercase tracking-wide text-muted mb-1 flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: avatarBg }} />
                          <span>{speakerLabel}</span>
                        </div>
                      )}
                      <div className="text-[11px] text-muted mb-1 flex items-center gap-2">
                        <span>{msToTimestamp(s.start_ms)} — {msToTimestamp(s.end_ms)}</span>
                        <span className="ml-auto text-[11px]">
                          {saveStatus[s.id] === 'saving' && <span className="text-amber-600">Saving…</span>}
                          {saveStatus[s.id] === 'saved' && <span className="text-emerald-600">Saved</span>}
                          {saveStatus[s.id] === 'error' && <span className="text-red-600">Save failed</span>}
                        </span>
                        <button
                          className="text-xs px-2 py-0.5 rounded border border-base hover:bg-surface-alt"
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation()
                            setEditingId((prev: string | null) => (prev === s.id ? null : s.id))
                            setEditingTexts((prev: Record<string, string>) => ({ ...prev, [s.id]: s.text }))
                          }}
                        >{editingId === s.id ? 'Close' : 'Edit'}</button>
                      </div>
                      {editingId === s.id ? (
                        <div className="text-sm">
                          <textarea
                            ref={(node: HTMLTextAreaElement | null) => {
                              if (node) {
                                textAreaRefs.current[s.id] = node
                              } else {
                                delete textAreaRefs.current[s.id]
                              }
                            }}
                            className="w-full border border-base bg-surface rounded p-2 min-h-[100px] text-current"
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
                        <div className="text-sm leading-7">
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
                                  <span key={`h-${m.matchIdx}-${idx2}`} className={`${m.matchIdx === matchIndex ? 'bg-yellow-400 text-black' : 'bg-yellow-200 text-black'}`}>{highlight}</span>
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
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Speaker Popover */}
      {speakerPopover && (
        <SpeakerPopover
          speakers={speakers}
          currentSpeaker={currentPopoverSpeaker}
          anchorRect={speakerPopover.anchorRect}
          onSelectSpeaker={handleSelectSpeaker}
          onCreateSpeaker={handleCreateSpeaker}
          onRenameSpeaker={handleRenameSpeaker}
          onUntag={handleUntag}
          onClose={() => setSpeakerPopover(null)}
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
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
