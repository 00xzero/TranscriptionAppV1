import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  fetchTranscriptData,
  fetchSpeakers,
  fetchProjectById,
} from '@/lib/supabase/queries'
import { SegmentSchema, WaveformStatusSchema, type WaveformStatus } from '@/contracts/db'
import { EditorProjectSchema, EditorSpeakerSchema } from '@/contracts/editor'
import type { Seg, Speaker } from '../types'
import { computeWordsForSegments } from '../utils'

const WaveformArtifactSchema = z.object({
  version: z.literal(1),
  duration_seconds: z.number(),
  points_per_second: z.number(),
  peaks: z.array(z.number()),
})

const WAVEFORM_POLL_INTERVAL_MS = 3000
const WAVEFORM_POLLABLE_STATUSES = new Set<WaveformStatus>(['pending', 'processing'])

export function useEditorData(projectId: string) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [segments, setSegments] = useState<Seg[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [projectTitle, setProjectTitle] = useState<string | null>(null)
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | null>(null)
  const [projectDurationSecs, setProjectDurationSecs] = useState<number | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('skipped')

  const reloadTranscript = async () => {
    try {
      const { items: segs } = await fetchTranscriptData(projectId)
      setSegments(computeWordsForSegments(segs) as Seg[])

      const speakerData = await fetchSpeakers(projectId)
      setSpeakers(speakerData)
    } catch (error) {
      console.error(`Failed to reload transcript for project ${projectId} while fetching transcript data or speakers:`, error)
    }
  }

  useEffect(() => {
    let cancelled = false
    let waveformPollId: ReturnType<typeof setInterval> | null = null

    const stopWaveformPolling = () => {
      if (waveformPollId) {
        clearInterval(waveformPollId)
        waveformPollId = null
      }
    }

    const loadWaveformPeaks = async () => {
      const urlRes = await fetch(`/api/projects/${projectId}/waveform-url`)
      if (!urlRes.ok) return false
      const { url } = await urlRes.json()
      const peaksRes = await fetch(url)
      if (!peaksRes.ok) return false
      const json = await peaksRes.json()
      const artifact = WaveformArtifactSchema.safeParse(json)
      if (cancelled) return false
      if (artifact.success) {
        setPeaks(artifact.data.peaks)
        return true
      }
      console.warn('[useEditorData] waveform artifact schema mismatch', artifact.error.issues)
      return false
    }

    const loadProjectMetadata = async (): Promise<WaveformStatus | null> => {
      const projectData = await fetchProjectById(projectId)
      if (cancelled || !projectData) return null
      const projectParsed = EditorProjectSchema.safeParse(projectData)
      if (!projectParsed.success) {
        console.warn('[useEditorData] project schema mismatch', projectParsed.error.issues)
      }
      setProjectTitle(projectData.title || null)
      setProjectCreatedAt(projectData.created_at)
      setProjectDurationSecs(projectData.duration_seconds)

      const statusParsed = WaveformStatusSchema.safeParse(projectData.waveform_status)
      const wfStatus: WaveformStatus = statusParsed.success ? statusParsed.data : 'skipped'
      setWaveformStatus(wfStatus)
      if (wfStatus === 'ready') {
        stopWaveformPolling()
        try {
          await loadWaveformPeaks()
        } catch (err) {
          console.warn('[useEditorData] failed to load waveform peaks (non-fatal):', err)
        }
        return wfStatus
      }
      if (!WAVEFORM_POLLABLE_STATUSES.has(wfStatus)) {
        stopWaveformPolling()
      }
      return wfStatus
    }

    const startWaveformPolling = () => {
      if (waveformPollId) return
      waveformPollId = setInterval(() => {
        void loadProjectMetadata().catch(() => { /* ignore */ })
      }, WAVEFORM_POLL_INTERVAL_MS)
    }

    const init = async () => {
      try {
        setStatus('Loading media...')

        const transcriptDataPromise = fetchTranscriptData(projectId).then(
          (data) => ({ data, error: null as unknown }),
          (error) => ({ data: null, error })
        )

        const mediaUrl = await fetch(`/api/projects/${projectId}/media-url`).then(async (res) => {
          if (!res.ok) throw new Error(`Failed to fetch media URL: ${res.status}`)
          const j = await res.json()
          return j.url as string
        })

        if (cancelled) return

        setAudioSrc(mediaUrl)

        const transcriptResult = await transcriptDataPromise
        if (transcriptResult.error) throw transcriptResult.error
        if (cancelled || !transcriptResult.data) return

        // Validate raw items before normalization
        const rawItems = transcriptResult.data.items
        const ItemsSchema = z.array(SegmentSchema)
        const itemsParsed = ItemsSchema.safeParse(rawItems)
        if (!itemsParsed.success) {
          console.warn('[useEditorData] transcript schema mismatch', itemsParsed.error.issues)
        }

        setSegments(computeWordsForSegments(transcriptResult.data.items) as Seg[])

        void fetchSpeakers(projectId)
          .then((speakerData) => {
            if (cancelled) return
            const speakersParsed = z.array(EditorSpeakerSchema).safeParse(speakerData)
            if (!speakersParsed.success) {
              console.warn('[useEditorData] speakers schema mismatch', speakersParsed.error.issues)
            }
            setSpeakers(speakerData)
          })
          .catch(() => { /* ignore */ })

        void loadProjectMetadata()
          .then((wfStatus) => {
            if (!cancelled && wfStatus && WAVEFORM_POLLABLE_STATUSES.has(wfStatus)) {
              startWaveformPolling()
            }
          })
          .catch(() => { /* ignore */ })

      } catch (e: any) {
        console.error(e)
        setStatus(`Error: ${e.message || e}`)
      }
    }
    init()
    return () => {
      cancelled = true
      stopWaveformPolling()
    }
  }, [projectId])

  return {
    audioSrc, setAudioSrc,
    status, setStatus,
    segments, setSegments,
    speakers, setSpeakers,
    projectTitle, setProjectTitle,
    projectCreatedAt,
    projectDurationSecs,
    peaks,
    waveformStatus,
    reloadTranscript,
  }
}
