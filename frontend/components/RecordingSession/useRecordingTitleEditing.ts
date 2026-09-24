import { useCallback, useRef, useState } from 'react'
import { TRANSCRIPT_TITLE_TOO_LONG, transcriptTitleTooLong } from '@/core/transcripts/title'

/**
 * Inline title-edit state for the live recording page. Mirrors the editor's
 * useTranscriptTitleEditing interaction (click to edit, Enter/blur to save,
 * Escape to cancel) but is synchronous: there is no transcript row yet, so
 * `onSave` writes to the in-memory session snapshot and cannot fail — hence no
 * saving state. The one error is a title over the length limit, which keeps the
 * field open instead of saving.
 *
 * An empty value is a deliberate "clear" (saves `null`), which restores the
 * generated `Recording — {date}` fallback in the store; this differs from the
 * editor hook, which treats an empty title as a no-op cancel.
 */
export function useRecordingTitleEditing({
  title,
  onSave,
}: {
  /** The current custom title (snapshot.title); null when only a generated title shows. */
  title: string | null
  onSave: (title: string | null) => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [tooLongSaveBlocked, setTooLongSaveBlocked] = useState(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  // Tracks editing state synchronously so a blur firing after Enter/Escape
  // (the input unmounts) doesn't double-save or resurrect a cancelled edit.
  const editingRef = useRef(false)

  const setEditing = useCallback((value: boolean) => {
    editingRef.current = value
    setEditingTitle(value)
  }, [])

  const startEditingTitle = useCallback(() => {
    setTitleInput(title || '')
    setTooLongSaveBlocked(false)
    setEditing(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [title, setEditing])

  const cancelEditingTitle = useCallback(() => {
    setEditing(false)
  }, [setEditing])

  const saveTitle = useCallback(() => {
    if (!editingRef.current) return
    const next = titleInput.trim()
    // Over the limit: stay in edit mode with the typed text; Escape cancels.
    if (transcriptTitleTooLong(next)) {
      setTooLongSaveBlocked(true)
      return
    }
    setEditing(false)
    onSave(next ? next : null)
  }, [titleInput, onSave, setEditing])

  const onTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveTitle()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditingTitle()
      }
    },
    [saveTitle, cancelEditingTitle]
  )

  const onTitleBlur = useCallback(() => {
    saveTitle()
  }, [saveTitle])

  // Clears itself as soon as the title fits again.
  const titleError =
    tooLongSaveBlocked && transcriptTitleTooLong(titleInput) ? TRANSCRIPT_TITLE_TOO_LONG : null

  return {
    editingTitle,
    titleInput,
    setTitleInput,
    titleError,
    titleInputRef,
    startEditingTitle,
    cancelEditingTitle,
    onTitleKeyDown,
    onTitleBlur,
  }
}
