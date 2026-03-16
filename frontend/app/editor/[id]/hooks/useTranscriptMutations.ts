import { useCallback, useEffect, useRef, useState } from 'react'
import { updateChunk } from '@/lib/supabase/queries'
import type { Seg, SaveStatusBySegment } from '../types'
import { SAVE_DEBOUNCE_MS, computeWordsForSegment } from '../utils'

export function useTranscriptMutations({
  source,
  setSegments,
}: {
  source: 'chunks' | 'segments'
  setSegments: React.Dispatch<React.SetStateAction<Seg[]>>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTexts, setEditingTexts] = useState<Record<string, string>>({})
  const [saveStatus, setSaveStatus] = useState<SaveStatusBySegment>({})
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const saveTimers = useRef<Record<string, number>>({})
  const saveStatusResetTimers = useRef<Record<string, number>>({})

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((timerId) => window.clearTimeout(timerId))
      Object.values(saveStatusResetTimers.current).forEach((timerId) => window.clearTimeout(timerId))
      saveTimers.current = {}
      saveStatusResetTimers.current = {}
    }
  }, [])

  const scheduleSave = useCallback((segId: string, newText: string) => {
    if (source === 'segments') return

    // update UI immediately
    setSegments((prev: Seg[]) => prev.map((s: Seg) => s.id === segId ? { ...s, text: newText, words: computeWordsForSegment({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, text: newText }) } : s))
    setSaveStatus((prev) => ({ ...prev, [segId]: 'saving' }))

    // clear existing timer
    const t = saveTimers.current[segId]
    if (t) { window.clearTimeout(t); delete saveTimers.current[segId] }
    const resetT = saveStatusResetTimers.current[segId]
    if (resetT) { window.clearTimeout(resetT); delete saveStatusResetTimers.current[segId] }

    // debounce before saving
    const timerId = window.setTimeout(async () => {
      try {
        delete saveTimers.current[segId]
        await updateChunk(segId, { text: newText })
        setSaveStatus((prev) => ({ ...prev, [segId]: 'saved' }))
        const savedResetTimerId = window.setTimeout(() => {
          delete saveStatusResetTimers.current[segId]
          setSaveStatus((p) => ({ ...p, [segId]: 'idle' }))
        }, 1200)
        saveStatusResetTimers.current[segId] = savedResetTimerId
      } catch (e) {
        console.error('save failed', e)
        setSaveStatus((prev) => ({ ...prev, [segId]: 'error' }))
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current[segId] = timerId
  }, [source, setSegments])

  return {
    editingId, setEditingId,
    editingTexts, setEditingTexts,
    saveStatus,
    textAreaRefs,
    scheduleSave,
  }
}
