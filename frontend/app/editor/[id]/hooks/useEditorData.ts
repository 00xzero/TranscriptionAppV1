import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  fetchTranscriptData,
  fetchSpeakers,
  fetchProjectById,
} from '@/lib/supabase/queries'
import { ChunkSchema, SegmentSchema } from '@/contracts/db'
import { EditorProjectSchema, EditorSpeakerSchema } from '@/contracts/editor'
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

        // Validate raw items before normalization
        const rawItems = transcriptResult.data.items
        const ItemsSchema = transcriptResult.data.source === 'chunks'
          ? z.array(ChunkSchema)
          : z.array(SegmentSchema)
        const itemsParsed = ItemsSchema.safeParse(rawItems)
        if (!itemsParsed.success) {
          console.warn('[useEditorData] transcript schema mismatch', itemsParsed.error.issues)
        }

        setSource(transcriptResult.data.source)
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

        void fetchProjectById(projectId)
          .then((projectData) => {
            if (cancelled || !projectData) return
            const projectParsed = EditorProjectSchema.safeParse(projectData)
            if (!projectParsed.success) {
              console.warn('[useEditorData] project schema mismatch', projectParsed.error.issues)
            }
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
