import { useEffect, useState } from 'react'
import {
  fetchTranscriptData,
  fetchSpeakers,
  fetchProjectById,
} from '@/lib/supabase/queries'
import type { Seg, Speaker } from '../types'
import { computeWordsForSegments } from '../utils'

export function useEditorData(projectId: string) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [status, setStatus] = useState('Loading media...')
  const [segments, setSegments] = useState<Seg[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [source, setSource] = useState<'chunks' | 'segments'>('chunks')
  const [projectTitle, setProjectTitle] = useState<string | null>(null)
  const [projectCreatedAt, setProjectCreatedAt] = useState<string | null>(null)
  const [projectDurationSecs, setProjectDurationSecs] = useState<number | null>(null)

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

        setSource(transcriptResult.data.source)
        setSegments(computeWordsForSegments(transcriptResult.data.items) as Seg[])

        void fetchSpeakers(projectId)
          .then((speakerData) => {
            if (cancelled) return
            setSpeakers(speakerData)
          })
          .catch(() => { /* ignore */ })

        void fetchProjectById(projectId)
          .then((projectData) => {
            if (cancelled || !projectData) return
            setProjectTitle(projectData.title || null)
            setProjectCreatedAt(projectData.created_at)
            setProjectDurationSecs(projectData.duration_seconds)
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
    }
  }, [projectId])

  return {
    audioSrc, setAudioSrc,
    status, setStatus,
    segments, setSegments,
    speakers, setSpeakers,
    source,
    projectTitle, setProjectTitle,
    projectCreatedAt,
    projectDurationSecs,
    reloadTranscript,
  }
}
