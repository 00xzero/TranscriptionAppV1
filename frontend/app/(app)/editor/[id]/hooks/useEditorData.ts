import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { pageAccountFetch } from '@/lib/auth/account-bound-fetch'
import {
  fetchEditorPeopleContext,
  fetchSegmentWordSets,
  fetchTranscriptData,
  fetchSpeakers,
  fetchTranscriptById,
  fetchTranscriptWaveformStatus,
} from '@/lib/supabase/queries'
import {
  SegmentSchema,
  type EditorPeopleContext,
  type WaveformStatus,
} from '@/contracts/db'
import { EditorTranscriptSchema, EditorSpeakerSchema, type EditorTranscript } from '@/contracts/editor'
import { WAVEFORM_ARTIFACT_VERSION } from '@/lib/audio/compute-peaks'
import { toast, type ToastOptions } from '@/components/ui/toaster'
import type { Seg, Speaker, WordsBySegment } from '../types'
import { groupEmbeddedWords, revisionsMatch } from '../utils'
import type { TranscriptionEngine } from '@/contracts/transcription-options'

const WaveformArtifactSchema = z.object({
  version: z.literal(WAVEFORM_ARTIFACT_VERSION),
  duration_seconds: z.number(),
  points_per_second: z.number(),
  peaks: z.array(z.number()),
})

const WAVEFORM_POLL_INTERVAL_MS = 3000
const WAVEFORM_POLL_TIMEOUT_MS = 2 * 60 * 1000
const WAVEFORM_POLLABLE_STATUSES = new Set<WaveformStatus>(['pending', 'processing'])
const NO_WORDS: WordsBySegment = new Map()

/** Word timings could not be loaded; Retry reloads segments and words. */
export const wordTimingsFailedToast = (retry: () => void): ToastOptions => ({
  title: "Couldn't load word timings",
  description: 'Word highlighting is off for this transcript.',
  variant: 'error',
  action: { label: 'Retry', onClick: retry },
})

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
 * `reloadContent` reloads segments and words together, keeping unsaved text.
 * It is called when words arrive out of step with the segments shown, and
 * from Retry after words failed to load. It must be stable.
 */
export function useEditorData(transcriptId: string, reloadContent: () => void, initialMetadata: EditorTranscript | null = null) {
  const [metadataSeed] = useState(initialMetadata)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [segments, setSegments] = useState<Seg[]>([])
  // The engine's words per segment: the fixed timing record edited text aligns to.
  const [wordsBySegment, setWordsBySegment] = useState<WordsBySegment>(NO_WORDS)
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [peopleContext, setPeopleContext] = useState<EditorPeopleContext>({ people: [] })
  const [transcriptTitle, setTitle] = useState<string | null>(initialMetadata?.title ?? null)
  const [transcriptCreatedAt, setTranscriptCreatedAt] = useState<string | null>(initialMetadata?.created_at ?? null)
  const [transcriptEngine, setTranscriptEngine] = useState<TranscriptionEngine | null>(initialMetadata?.engine ?? null)
  // The model that really made it, when the engine says (AssemblyAI's fallback).
  const [transcriptEngineModel, setTranscriptEngineModel] = useState<string | null>(initialMetadata?.engine_model ?? null)
  const [transcriptDurationSecs, setTranscriptDurationSecs] = useState<number | null>(initialMetadata?.duration_seconds ?? null)
  const [transcriptProjectId, setTranscriptProjectId] = useState<string | null>(initialMetadata?.project_id ?? null)
  const titleVersion = useRef(0)
  const setTranscriptTitle = useCallback((title: string | null) => {
    titleVersion.current++
    setTitle(title)
  }, [])
  const [waveformDurationSecs, setWaveformDurationSecs] = useState<number | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('skipped')
  // Set once init has shown this transcript's segments. Until then init holds
  // the freshest data, and anything loaded alongside it could be overwritten
  // by its rows, read a moment earlier.
  const loadedRef = useRef(false)
  const isLoaded = useCallback(() => loadedRef.current, [])

  useEffect(() => {
    let cancelled = false
    loadedRef.current = false
    let waveformPollId: ReturnType<typeof setInterval> | null = null
    let waveformPollStartedAt = 0
    let waveformReading = false
    let waveformVersion = 0
    let lastWaveformStatus = metadataSeed?.waveform_status
    let metadataReading = false
    setPeaks(null)
    setWaveformDurationSecs(null)
    setWaveformStatus('skipped')
    setWordsBySegment(NO_WORDS)

    const stopWaveformPolling = () => {
      if (waveformPollId) {
        clearInterval(waveformPollId)
        waveformPollId = null
      }
    }

    const loadWaveformPeaks = async () => {
      const urlRes = await pageAccountFetch(`/api/transcripts/${transcriptId}/waveform-url`)
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

    const showWaveform = async (wfStatus: WaveformStatus) => {
      if (cancelled) return
      setWaveformStatus(wfStatus)
      if (wfStatus === 'ready') {
        try {
          const loaded = await loadWaveformPeaks()
          if (loaded) {
            stopWaveformPolling()
            return
          }
        } catch (err) {
          console.warn('[useEditorData] failed to load waveform peaks (non-fatal):', err)
        }
      }
      if (wfStatus === 'ready' || WAVEFORM_POLLABLE_STATUSES.has(wfStatus)) {
        if (!cancelled) startWaveformPolling()
      } else stopWaveformPolling()
    }

    const startWaveformPolling = () => {
      if (waveformPollId) return
      waveformPollStartedAt = Date.now()
      waveformPollId = setInterval(async () => {
        if (Date.now() - waveformPollStartedAt >= WAVEFORM_POLL_TIMEOUT_MS) {
          console.warn(`[useEditorData] stopped waveform polling for transcript ${transcriptId} after timeout`)
          stopWaveformPolling()
          setWaveformStatus('skipped')
          return
        }
        if (waveformReading) return
        waveformReading = true
        waveformVersion++
        try {
          lastWaveformStatus = await fetchTranscriptWaveformStatus(transcriptId)
          await showWaveform(lastWaveformStatus)
        } catch { /* Poll again until it answers or times out. */ }
        finally { waveformReading = false }
      }, WAVEFORM_POLL_INTERVAL_MS)
    }

    const loadTranscriptMetadata = async () => {
      if (cancelled || metadataReading) return
      metadataReading = true
      const expectedTitleVersion = titleVersion.current
      const expectedWaveformVersion = waveformVersion
      try {
        const data = await fetchTranscriptById(transcriptId)
        if (cancelled) return
        if (!data) throw new Error('Transcript metadata unavailable')
        const invalid: (keyof EditorTranscript)[] = []
        const read = <K extends keyof EditorTranscript>(key: K, apply: (value: EditorTranscript[K]) => void) => {
          const result = EditorTranscriptSchema.shape[key].safeParse(data[key])
          if (result.success) apply(result.data as EditorTranscript[K])
          else invalid.push(key)
        }
        read('title', (title) => {
          if (titleVersion.current === expectedTitleVersion) setTitle(title || null)
        })
        read('created_at', setTranscriptCreatedAt)
        read('engine', setTranscriptEngine)
        read('engine_model', setTranscriptEngineModel)
        read('duration_seconds', setTranscriptDurationSecs)
        read('project_id', setTranscriptProjectId)
        read('waveform_status', (status) => {
          if (status !== lastWaveformStatus && waveformVersion === expectedWaveformVersion && !waveformReading) {
            lastWaveformStatus = status
            void showWaveform(status)
          }
        })
        if (invalid.length) console.warn('[useEditorData] invalid transcript metadata fields', invalid)
      } catch (error) {
        if (cancelled) return
        console.error('[useEditorData] failed to load transcript metadata', error)
        toast({
          title: "Couldn't load transcript details",
          variant: 'error',
          action: { label: 'Retry', onClick: () => { void loadTranscriptMetadata() } },
        })
      } finally {
        metadataReading = false
      }
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

    // The segments init shows, once it shows them; null if it never does.
    let resolveSegmentsShown!: (rows: Seg[] | null) => void
    const segmentsShown = new Promise<Seg[] | null>((resolve) => { resolveSegmentsShown = resolve })

    // Words load beside the segments and never hold them up. Until they arrive,
    // or if they fail, cards show no playing-word highlight and clicks aim at an
    // even spread across the segment, as before word timings existed. Each
    // segment's words arrive with its revision: if a split or rejoin elsewhere
    // has moved any segment on from the one shown, the words are not used, and
    // segments and words reload together instead.
    // Async so even a synchronous throw lands in reportWordLoadFailure.
    const loadWords = async () => fetchSegmentWordSets(transcriptId)
    const showWords = async (sets: Awaited<ReturnType<typeof fetchSegmentWordSets>>) => {
      const shown = await segmentsShown
      if (cancelled || !shown) return
      if (shown.length !== sets.length || !revisionsMatch(shown, sets)) {
        reloadContent()
        return
      }
      // A reload, or a split here, may have stored newer words while these
      // were in flight; those already match the segments, so keep them.
      const grouped = groupEmbeddedWords(sets)
      setWordsBySegment((current) => (current === NO_WORDS ? grouped : current))
    }
    const reportWordLoadFailure = (error: unknown) => {
      if (cancelled) return
      console.error(`[useEditorData] failed to load word timings for transcript ${transcriptId}:`, error)
      toast(wordTimingsFailedToast(reloadContent))
    }

    const init = async () => {
      try {
        setStatus('Loading media...')

        if (metadataSeed) void showWaveform(metadataSeed.waveform_status)
        void loadTranscriptMetadata()
        void loadWords().then(showWords).catch(reportWordLoadFailure)

        const transcriptDataPromise = fetchTranscriptData(transcriptId).then(
          (data) => ({ data, error: null as unknown }),
          (error) => ({ data: null, error })
        )
        const speakersPromise = loadSpeakers().then(
          (data) => ({ data, error: null as unknown }),
          (error) => ({ data: null, error })
        )

        const mediaUrl = await pageAccountFetch(`/api/transcripts/${transcriptId}/media-url`).then(async (res) => {
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
        setSegments(transcriptResult.data.items)
        loadedRef.current = true
        resolveSegmentsShown(transcriptResult.data.items)
        if (speakersResult.data) showSpeakers(speakersResult.data)
        else reportSpeakerLoadFailure(speakersResult.error)

      } catch (e: any) {
        console.error(e)
        if (!cancelled) setStatus(`Error: ${e.message || e}`)
      } finally {
        resolveSegmentsShown(null)
      }
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void loadTranscriptMetadata()
    }
    window.addEventListener('pageshow', onPageShow)
    void init()
    return () => {
      cancelled = true
      window.removeEventListener('pageshow', onPageShow)
      stopWaveformPolling()
    }
  }, [transcriptId, reloadContent, metadataSeed])

  return {
    audioSrc, setAudioSrc,
    status, setStatus,
    segments, setSegments,
    wordsBySegment, setWordsBySegment,
    speakers, setSpeakers,
    peopleContext, setPeopleContext,
    transcriptTitle, setTranscriptTitle,
    transcriptCreatedAt,
    transcriptEngine,
    transcriptEngineModel,
    transcriptDurationSecs: chooseEditorDuration(transcriptDurationSecs, waveformDurationSecs),
    transcriptProjectId,
    waveformDurationSecs,
    peaks,
    waveformStatus,
    isLoaded,
  }
}
