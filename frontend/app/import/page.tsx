"use client"
import React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { getApiBase, getAuthHeaders } from '../../lib/api'

// Expected JSON format for transcript import:
// {
//   "replace_existing": true,
//   "segments": [
//     {
//       "id": "optional-id",
//       "speaker_id": "optional-speaker-id",
//       "start_ms": 0,
//       "end_ms": 3500,
//       "text": "Hello world",
//       "words": [ { "start_ms": 0, "end_ms": 300, "text": "Hello" }, ... ]
//     }

  type Segment = { start_ms: number; end_ms: number; text: string; speaker_label?: string }
  const MAX_TURN_DURATION_MS = 30000
  const MAX_TURN_CHARS = 550

  // Merge consecutive segments with the same speaker label into larger speaker turns
  const coalesceBySpeaker = (items: Segment[]): Segment[] => {
    if (!items.length) return []
    // Split any single oversized segment into manageable chunks first
    const splitOversize = (seg: Segment): Segment[] => {
      const dur = Math.max(1, seg.end_ms - seg.start_ms)
      const txt = String(seg.text || '')
      const totalCharsNoWs = txt.replace(/\s+/g, '').length || 1
      const sentences = txt.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [txt]
      // If only one sentence and it's already under limits, return as-is
      const sentChars = sentences.map(s => s.replace(/\s+/g, '').length)
      const allUnder = dur <= MAX_TURN_DURATION_MS && totalCharsNoWs <= MAX_TURN_CHARS
      if (sentences.length === 1 && allUnder) return [seg]

      const chunks: string[] = []
      let buf: string[] = []
      let bufChars = 0
      let consumedChars = 0
      for (let i = 0; i < sentences.length; i++) {
        const snt = sentences[i]
        const sntChars = sentChars[i] || 0
        const nextBufChars = bufChars + sntChars
        const projectedDur = Math.floor(dur * (consumedChars + nextBufChars) / totalCharsNoWs)
        const wouldExceed = nextBufChars > MAX_TURN_CHARS || projectedDur > MAX_TURN_DURATION_MS
        if (wouldExceed && buf.length > 0) {
          chunks.push(buf.join('').trim())
          consumedChars += bufChars
          buf = [snt]
          bufChars = sntChars
        } else {
          buf.push(snt)
          bufChars = nextBufChars
        }
      }
      if (buf.length) {
        chunks.push(buf.join('').trim())
        consumedChars += bufChars
      }

      // Fallback: extremely long first sentence; split by words
      const ensureChunks = (arr: string[]): string[] => {
        if (arr.length === 1 && arr[0].replace(/\s+/g, '').length > MAX_TURN_CHARS) {
          const tokens = arr[0].split(/(\s+)/).filter(Boolean)
          const outParts: string[] = []
          let acc: string[] = []
          let accChars = 0
          for (let t of tokens) {
            const tChars = /^\s+$/.test(t) ? 0 : t.length
            if (accChars + tChars > MAX_TURN_CHARS && acc.length) {
              outParts.push(acc.join('').trim())
              acc = []
              accChars = 0
            }
            acc.push(t)
            accChars += tChars
          }
          if (acc.length) outParts.push(acc.join('').trim())
          return outParts
        }
        return arr
      }

      const finalChunks = ensureChunks(chunks)
      // Assign timings proportionally
      const out: Segment[] = []
      let cursor = seg.start_ms
      const sumChars = finalChunks.reduce((a, c) => a + (c.replace(/\s+/g, '').length || 1), 0) || 1
      for (let i = 0; i < finalChunks.length; i++) {
        const c = finalChunks[i]
        const weight = (c.replace(/\s+/g, '').length || 1) / sumChars
        const partDur = i === finalChunks.length - 1 ? (seg.end_ms - cursor) : Math.min(MAX_TURN_DURATION_MS, Math.max(200, Math.floor(dur * weight)))
        const end = Math.min(seg.end_ms, cursor + partDur)
        out.push({ start_ms: cursor, end_ms: end, text: c, speaker_label: seg.speaker_label })
        cursor = end
      }
      if (out.length) out[out.length - 1].end_ms = seg.end_ms
      for (let k = 1; k < out.length; k++) {
        if (out[k].start_ms < out[k - 1].end_ms) out[k].start_ms = out[k - 1].end_ms
        if (out[k].end_ms < out[k].start_ms) out[k].end_ms = out[k].start_ms + 200
      }
      return out
    }
    // Ensure chronological order
    const src = items.flatMap(splitOversize).sort((a, b) => a.start_ms - b.start_ms)
    const out: Segment[] = []
    for (const s of src) {
      const last = out[out.length - 1]
      const sameSpeaker = !!(last && last.speaker_label && s.speaker_label && last.speaker_label === s.speaker_label)
      const continuousOrOverlap = last ? s.start_ms <= last.end_ms + 1000 /* allow small 1s gap */ : false
      if (sameSpeaker && continuousOrOverlap) {
        const newEnd = Math.max(last.end_ms, s.end_ms)
        const newDuration = newEnd - last.start_ms
        const newChars = (last.text?.length || 0) + 1 + (s.text?.length || 0)
        if (newDuration > MAX_TURN_DURATION_MS || newChars > MAX_TURN_CHARS) {
          // start a new chunk to avoid overly large blocks
          out.push({ ...s })
        } else {
          last.end_ms = newEnd
          last.text = last.text ? `${last.text}\n${s.text}` : s.text
        }
      } else {
        out.push({ ...s })
      }
    }
    return out
  }
//   ]
// }

export default function ImportPage() {
  const api = getApiBase()
  const [audio, setAudio] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [replaceExisting, setReplaceExisting] = useState(true)
  const [status, setStatus] = useState<string>('Idle')
  const [busy, setBusy] = useState(false)

  const onAudioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAudio(e.target.files?.[0] || null)
  }, [])

  const onJsonChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setJsonFile(e.target.files?.[0] || null)
  }, [])

  const readJson = async (file: File): Promise<any> => {
    const text = await file.text()
    try { return JSON.parse(text) } catch (e: any) { throw new Error('Invalid JSON: ' + (e.message || e)) }
  }

  const normalizePayload = (raw: any) => {
    // Accept either {segments:[...] } or the full shape; also accept a bare array as segments
    if (Array.isArray(raw)) return { replace_existing: replaceExisting, segments: raw }
    if (raw && Array.isArray(raw.segments)) return { replace_existing: (raw.replace_existing ?? replaceExisting), segments: raw.segments }
    throw new Error('JSON must be an array of segments or an object with a "segments" array')
  }

  // --- Helpers for VTT and DOCX imports ---
  const parseVttTimestamp = (s: string): number => {
    // Formats: hh:mm:ss.mmm or mm:ss.mmm
    const m = s.trim().match(/^(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})$/)
    if (!m) return 0
    const hh = parseInt(m[1] || '0', 10)
    const mm = parseInt(m[2], 10)
    const ss = parseInt(m[3], 10)
    const ms = parseInt(m[4], 10)
    return ((hh * 3600 + mm * 60 + ss) * 1000 + ms)
  }

  

  const parseVtt = (text: string): Segment[] => {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    const segments: Segment[] = []
    let i = 0
    // Skip header lines like WEBVTT
    while (i < lines.length && lines[i].trim() === '') i++
    if (i < lines.length && /^WEBVTT/i.test(lines[i])) i++
    while (i < lines.length) {
      // Optional cue id
      if (lines[i] && !/-->/.test(lines[i]) && lines[i].trim() !== '') { i++ }
      if (i >= lines.length) break
      const m = lines[i].match(/([^\s]+)\s*-->\s*([^\s]+)/)
      if (!m) { i++; continue }
      const start = parseVttTimestamp(m[1])
      const end = parseVttTimestamp(m[2])
      i++
      const textLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i])
        i++
      }
      // skip blank separator
      while (i < lines.length && lines[i].trim() === '') i++
      // Extract WebVTT voice tag: <v Name> or <v.class Name> (supports multiple classes)
      let speakerLabel: string | undefined
      const block = textLines.join('\n')
      const vm = block.match(/<v(?:\.[^>\s]+)*\s*([^>]*?)>/i)
      if (vm && vm[1]) speakerLabel = vm[1].trim()
      const cueText = textLines.join('\n').replace(/<[^>]+>/g, '').trim()
      if (end > start) segments.push({ start_ms: start, end_ms: end, text: cueText, speaker_label: speakerLabel })
    }
    return segments
  }

  const getAudioDurationSec = (file: File): Promise<number> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audioEl = new Audio()
    const cleanup = () => URL.revokeObjectURL(url)
    audioEl.preload = 'metadata'
    audioEl.onloadedmetadata = () => { const d = audioEl.duration; cleanup(); if (!isFinite(d) || d <= 0) reject(new Error('Invalid audio duration')); else resolve(d) }
    audioEl.onerror = () => { cleanup(); reject(new Error('Could not read audio duration')) }
    audioEl.src = url
  })

  const parseDocx = async (file: File, audioFile: File): Promise<Segment[]> => {
    // Convert Docx to HTML, then split into paragraphs and distribute timings across audio duration proportionally to text length.
    const mammoth = await import('mammoth/mammoth.browser')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer })
    const html = result.value || ''
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const paras = Array.from(doc.body.querySelectorAll('p')).map(p => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (paras.length === 0) throw new Error('No paragraphs found in DOCX')
    const durationSec = await getAudioDurationSec(audioFile)
    const durationMs = Math.max(1, Math.floor(durationSec * 1000))
    const lengths = paras.map(t => Math.max(1, t.length))
    const totalLen = lengths.reduce((a, b) => a + b, 0)
    let cursor = 0
    const segs: Segment[] = []
    for (let idx = 0; idx < paras.length; idx++) {
      const portion = lengths[idx] / totalLen
      const segDur = idx === paras.length - 1 ? (durationMs - cursor) : Math.max(200, Math.floor(durationMs * portion))
      const start = cursor
      const end = Math.min(durationMs, start + segDur)
      cursor = end
      segs.push({ start_ms: start, end_ms: end, text: paras[idx] })
    }
    // Ensure strictly increasing and within [0, duration]
    for (let k = 1; k < segs.length; k++) {
      if (segs[k].start_ms < segs[k-1].end_ms) segs[k].start_ms = segs[k-1].end_ms
      if (segs[k].end_ms < segs[k].start_ms) segs[k].end_ms = segs[k].start_ms + 200
    }
    if (segs[segs.length - 1].end_ms < durationMs) segs[segs.length - 1].end_ms = durationMs
    return segs
  }

  const runImport = useCallback(async () => {
    if (!audio) { setStatus('Please select an audio/video file'); return }
    if (!jsonFile) { setStatus('Please select a transcript file (JSON, VTT, or DOCX)'); return }
    setBusy(true)
    setStatus('Reading transcript...')
    try {
      const ext = (jsonFile.name.split('.').pop() || '').toLowerCase()
      let payload: { replace_existing: boolean; segments: Segment[] }
      if (ext === 'json') {
        const data = await readJson(jsonFile)
        payload = normalizePayload(data)
      } else if (ext === 'vtt') {
        const vttText = await jsonFile.text()
        const segmentsRaw = parseVtt(vttText)
        const segments = coalesceBySpeaker(segmentsRaw)
        if (!segments.length) throw new Error('No cues found in VTT')
        payload = { replace_existing: replaceExisting, segments }
      } else if (ext === 'docx') {
        const segmentsRaw = await parseDocx(jsonFile, audio)
        const segments = coalesceBySpeaker(segmentsRaw)
        payload = { replace_existing: replaceExisting, segments }
      } else {
        throw new Error('Unsupported transcript type. Please upload .json, .vtt, or .docx')
      }

      // Step 1: Create project
      setStatus('Creating project...')
      const createRes = await fetch(`${api}/projects`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: audio.name, filename: audio.name, content_type: audio.type || 'application/octet-stream' }),
      })
      if (!createRes.ok) throw new Error(`Create project failed: ${createRes.status}`)
      const presigned = await createRes.json()

      // Step 2: Upload audio to object storage via presigned URL
      setStatus('Uploading media to object storage...')
      const putRes = await fetch(presigned.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': audio.type || 'application/octet-stream' },
        body: audio,
      })
      if (!putRes.ok) throw new Error(`Media upload failed: ${putRes.status}`)

      // Step 3: Import segments
      setStatus('Importing segments...')
      const impRes = await fetch(`${api}/projects/${presigned.project.id}/segments/import`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!impRes.ok) {
        const t = await impRes.text()
        throw new Error(`Import failed (${impRes.status}): ${t}`)
      }

      setStatus('Done! Opening editor...')
      window.location.href = `/editor/${presigned.project.id}`
    } catch (e: any) {
      console.error(e)
      setStatus(`Error: ${e.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [api, audio, jsonFile, replaceExisting])

  const exampleJson = `{
  "replace_existing": true,
  "segments": [
    {
      "start_ms": 0,
      "end_ms": 2500,
      "text": "Hello world",
      "words": [ { "start_ms": 0, "end_ms": 400, "text": "Hello" }, { "start_ms": 400, "end_ms": 900, "text": "world" } ]
    },
    {
      "start_ms": 2600,
      "end_ms": 5000,
      "text": "This is a second segment."
    }
  ]
}`

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Import Transcript + Audio</h1>
      <div className="bg-surface border border-base rounded p-4 space-y-4">
        <div className="space-y-1">
          <label className="font-medium">Audio/Video file</label>
          <input type="file" accept="audio/*,video/*" onChange={onAudioChange} />
          {audio && <div className="text-xs text-muted">{audio.name} • {audio.type || 'application/octet-stream'} • {Math.round(audio.size/1024)} KB</div>}
        </div>
        <div className="space-y-1">
          <label className="font-medium">Transcript file (JSON, VTT, DOCX)</label>
          <input type="file" accept="application/json,.json,.vtt,text/vtt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onJsonChange} />
          <div className="text-xs text-muted">Upload a WebVTT (.vtt), Word (.docx), or our JSON schema. For .docx without timestamps, timings are distributed over the audio duration.</div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
          Replace existing segments (if any)
        </label>
        <div>
          <button className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={!audio || !jsonFile || busy} onClick={runImport}>
            {busy ? 'Importing...' : 'Import'}
          </button>
        </div>
        <div className="text-sm text-muted">{status}</div>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">Transcript JSON example</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{exampleJson}</pre>
        </details>
      </div>
    </div>
  )
}
