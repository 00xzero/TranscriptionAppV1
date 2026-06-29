import { useCallback, useRef, useState } from 'react'
import { updateTranscript } from '@/lib/supabase/queries'

export function useTranscriptTitleEditing({
  transcriptId,
  transcriptTitle,
  setTranscriptTitle,
}: {
  transcriptId: string
  transcriptTitle: string | null
  setTranscriptTitle: (title: string | null) => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isSavingTitleRef = useRef(false)

  const startEditingTitle = useCallback(() => {
    setTitleInput(transcriptTitle || '')
    setTitleSaveError(null)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [transcriptTitle])

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
      await updateTranscript(transcriptId, { title: newTitle })
      setTranscriptTitle(newTitle)
      setEditingTitle(false)
    } catch (err) {
      console.error('Failed to save title:', err)
      setTitleSaveError('Failed to save title. Please try again.')
    } finally {
      isSavingTitleRef.current = false
    }
  }, [titleInput, transcriptId, setTranscriptTitle])

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
