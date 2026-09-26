import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  fetchEditorPeopleContext,
  fetchTranscriptData,
  fetchSpeakers,
  fetchTranscriptById,
} from '@/lib/supabase/queries'
import {
  SegmentSchema,
  WaveformStatusSchema,
  type EditorPeopleContext,
  type WaveformStatus,
} from '@/contracts/db'
import { EditorTranscriptSchema, EditorSpeakerSchema } from '@/contracts/editor'
import { WAVEFORM_ARTIFACT_VERSION } from '@/lib/audio/compute-peaks'
import { toast } from '@/components/ui/toaster'
import type { Seg, Speaker } from '../types'
import { computeWordsForSegments } from '../utils'

const WaveformArtifactSchema = z.object({
  version: z.literal(WAVEFORM_ARTIFACT_VERSION),
  duration_seconds: z.number(),
  points_per_second: z.number(),
  peaks: z.array(z.number()),
})

const WAVEFORM_POLL_INTERVAL_MS = 3000
const WAVEFORM_POLL_TIMEOUT_MS = 2 * 60 * 1000
const WAVEFORM_POLLABLE_STATUSES = new Set<WaveformStatus>(['pending', 'processing'])

export function chooseEditorDuration(
  transcriptDurationSecs: number | null,
  waveformDurationSecs: number | null
): number | null {
  const durations = [transcriptDurationSecs, waveformDurationSecs].filter(
    (duration): duration is number => duration != null && Number.isFinite(duration) && duration > 0
  )
  if (durations.length === 0) return null
  return Math.max(...durations)
}

/**
 * Takes each segment's speaker_id from `fetched` and keeps everything else as
 * the editor holds it — above all the text, which may carry an edit whose
 * debounced save has not reached the database yet.
 */
export function mergeSpeakerAssignments(
  current: Seg[],
  fetched: readonly { id: string; speaker_id: string | null }[]
): Seg[] {
  const speakerIdBySegment = new Map(fetched.map((s) => [s.id, s.speaker_id]))
  return current.map((s) =>
    speakerIdBySegment.has(s.id) ? { ...s, speaker_id: speakerIdBySegment.get(s.id) ?? null } : s
  )
}

export function useEditorData(transcriptId: string) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [segments, setSegments] = useState<Seg[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [peopleContext, setPeopleContext] = useState<EditorPeopleContext>({ people: [] })
  const [transcriptTitle, setTranscriptTitle] = useState<string | null>(null)
  const [transcriptCreatedAt, setTranscriptCreatedAt] = useState<string | null>(null)
  const [transcriptDurationSecs, setTranscriptDurationSecs] = useState<number | null>(null)
  const [transcriptProjectId, setTranscriptProjectId] = useState<string | null>(null)
  const [waveformDurationSecs, setWaveformDurationSecs] = useState<number | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('skipped')

  useEffect(() => {
    let cancelled = false
    let waveformPollId: ReturnType<typeof setInterval> | null = null
    let waveformPollStartedAt = 0
    setPeaks(null)
    setWaveformDurationSecs(null)
    setWaveformStatus('skipped')

    const stopWaveformPolling = () => {
      if (waveformPollId) {
        clearInterval(waveformPollId)
        waveformPollId = null
      }
    }

    const loadWaveformPeaks = async () => {
      const urlRes = await fetch(`/api/transcripts/${transcriptId}/waveform-url`)
      if (!urlRes.ok) return false
      const { url } = await urlRes.json()
      const peaksRes = await fetch(url)
      if (!peaksRes.ok) return false
      const json = await peaksRes.json()
      const artifact = WaveformArtifactSchema.safeParse(json)
      if (cancelled) return false
      if (artifact.success) {
        setPeaks(artifact.data.peaks)
        setWaveformDurationSecs(artifact.data.duration_seconds)
        return true
      }
      console.warn('[useEditorData] waveform artifact schema mismatch', artifact.error.issues)
      return false
    }

    const loadTranscriptMetadata = async (): Promise<WaveformStatus | null> => {
      const transcriptData = await fetchTranscriptById(transcriptId)
      if (cancelled || !transcriptData) return null
      const transcriptParsed = EditorTranscriptSchema.safeParse(transcriptData)
      if (!transcriptParsed.success) {
        console.warn('[useEditorData] transcript schema mismatch', transcriptParsed.error.issues)
      }
      setTranscriptTitle(transcriptData.title || null)
      setTranscriptCreatedAt(transcriptData.created_at)
      setTranscriptDurationSecs(transcriptData.duration_seconds)
      setTranscriptProjectId(transcriptData.project_id)

      const statusParsed = WaveformStatusSchema.safeParse(transcriptData.waveform_status)
      const wfStatus: WaveformStatus = statusParsed.success ? statusParsed.data : 'skipped'
      setWaveformStatus(wfStatus)
      if (wfStatus === 'ready') {
        try {
          const loaded = await loadWaveformPeaks()
          if (loaded) {
            stopWaveformPolling()
            return wfStatus
          }
        } catch (err) {
          console.warn('[useEditorData] failed to load waveform peaks (non-fatal):', err)
        }
        return 'processing'
      }
      if (!WAVEFORM_POLLABLE_STATUSES.has(wfStatus)) {
        stopWaveformPolling()
      }
      return wfStatus
    }

    const startWaveformPolling = () => {
      if (waveformPollId) return
      waveformPollStartedAt = Date.now()
      waveformPollId = setInterval(() => {
        if (Date.now() - waveformPollStartedAt >= WAVEFORM_POLL_TIMEOUT_MS) {
          console.warn(`[useEditorData] stopped waveform polling for transcript ${transcriptId} after timeout`)
          stopWaveformPolling()
          setWaveformStatus('skipped')
          return
        }
        void loadTranscriptMetadata().catch(() => { /* ignore */ })
      }, WAVEFORM_POLL_INTERVAL_MS)
    }

    // Speakers and people arrive together: a linked speaker shown without its
    // person would read as an unlinked voice with the wrong label.
    const loadSpeakers = () => Promise.all([fetchSpeakers(transcriptId), fetchEditorPeopleContext(transcriptId)])
    const showSpeakers = ([speakerData, context]: [Speaker[], EditorPeopleContext]) => {
      if (cancelled) return
      const speakersParsed = z.array(EditorSpeakerSchema).safeParse(speakerData)
      if (!speakersParsed.success) {
        console.warn('[useEditorData] speakers schema mismatch', speakersParsed.error.issues)
      }
      setSpeakers(speakerData)
      setPeopleContext(context)
    }
    const reportSpeakerLoadFailure = (error: unknown) => {
      if (cancelled) return
      console.error(`[useEditorData] failed to load speakers for transcript ${transcriptId}:`, error)
      toast({
        title: "Couldn't load speakers",
        description: 'Every segment shows Unknown speaker until they load.',
        variant: 'error',
        action: { label: 'Retry', onClick: () => { void loadSpeakers().then(showSpeakers, reportSpeakerLoadFailure) } },
      })
    }

    const init = async () => {
      try {
        setStatus('Loading media...')

        const transcriptDataPromise = fetchTranscriptData(transcriptId).then(
          (data) => ({ data, error: null as unknown }),
          (error) => ({ data: null, error })
        )
        const speakersPromise = loadSpeakers().then(
          (data) => ({ data, error: null as unknown }),
          (error) => ({ data: null, error })
        )

        const mediaUrl = await fetch(`/api/transcripts/${transcriptId}/media-url`).then(async (res) => {
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

        // Segments and their speakers render in the same pass.
        const speakersResult = await speakersPromise
        if (cancelled) return
        setSegments(computeWordsForSegments(transcriptResult.data.items) as Seg[])
        if (speakersResult.data) showSpeakers(speakersResult.data)
        else reportSpeakerLoadFailure(speakersResult.error)

        void loadTranscriptMetadata()
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
  }, [transcriptId])

  return {
    audioSrc, setAudioSrc,
    status, setStatus,
    segments, setSegments,
    speakers, setSpeakers,
    peopleContext, setPeopleContext,
    transcriptTitle, setTranscriptTitle,
    transcriptCreatedAt,
    transcriptDurationSecs: chooseEditorDuration(transcriptDurationSecs, waveformDurationSecs),
    transcriptProjectId,
    waveformDurationSecs,
    peaks,
    waveformStatus,
  }
}
