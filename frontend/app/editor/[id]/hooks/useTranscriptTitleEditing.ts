import { useCallback, useRef, useState } from 'react'
import { updateTranscript } from '@/lib/supabase/queries'
import { TRANSCRIPT_TITLE_TOO_LONG, transcriptTitleTooLong } from '@/core/transcripts/title'

export function useTranscriptTitleEditing({
  transcriptId,
  transcriptTitle,
  setTranscriptTitle,
  onTitleSaved,
}: {
  transcriptId: string
  transcriptTitle: string | null
  setTranscriptTitle: (title: string | null) => void
  onTitleSaved: (title: string) => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [saveFailure, setSaveFailure] = useState<string | null>(null)
  const [tooLongSaveBlocked, setTooLongSaveBlocked] = useState(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isSavingTitleRef = useRef(false)

  const startEditingTitle = useCallback(() => {
    setTitleInput(transcriptTitle || '')
    setSaveFailure(null)
    setTooLongSaveBlocked(false)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [transcriptTitle])

  const saveTitle = useCallback(async () => {
    if (isSavingTitleRef.current) return

    const newTitle = titleInput.trim()
    if (!newTitle) {
      setEditingTitle(false)
      setSaveFailure(null)
      return
    }
    // Over the limit: keep the field open with the typed text; Escape cancels.
    if (transcriptTitleTooLong(newTitle)) {
      setTooLongSaveBlocked(true)
      return
    }

    isSavingTitleRef.current = true
    setSaveFailure(null)

    try {
      await updateTranscript(transcriptId, { title: newTitle })
      onTitleSaved(newTitle)
      setTranscriptTitle(newTitle)
      setEditingTitle(false)
    } catch (err) {
      console.error('Failed to save title:', err)
      setSaveFailure('Failed to save title. Please try again.')
    } finally {
      isSavingTitleRef.current = false
    }
  }, [onTitleSaved, setTranscriptTitle, titleInput, transcriptId])

  const onTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditingTitle(false)
      setSaveFailure(null)
      setTooLongSaveBlocked(false)
    }
  }, [saveTitle])

  const onTitleBlur = useCallback(() => {
    if (isSavingTitleRef.current) return
    saveTitle()
  }, [saveTitle])

  // The length error clears itself as soon as the title fits again.
  const titleSaveError =
    saveFailure ?? (tooLongSaveBlocked && transcriptTitleTooLong(titleInput) ? TRANSCRIPT_TITLE_TOO_LONG : null)

  return {
    editingTitle,
    titleInput, setTitleInput,
    titleSaveError,
    titleInputRef,
    startEditingTitle,
    onTitleKeyDown,
    onTitleBlur,
  }
}
