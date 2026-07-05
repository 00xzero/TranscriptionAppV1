import { useCallback, useRef, useState } from 'react'

/**
 * Inline title-edit state for the live recording page. Mirrors the editor's
 * useTranscriptTitleEditing interaction (click to edit, Enter/blur to save,
 * Escape to cancel) but is synchronous: there is no transcript row yet, so
 * `onSave` writes to the in-memory session snapshot and cannot fail — hence no
 * saving/error state.
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
    setEditing(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [title, setEditing])

  const cancelEditingTitle = useCallback(() => {
    setEditing(false)
  }, [setEditing])

  const saveTitle = useCallback(() => {
    if (!editingRef.current) return
    setEditing(false)
    const next = titleInput.trim()
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

  return {
    editingTitle,
    titleInput,
    setTitleInput,
    titleInputRef,
    startEditingTitle,
    cancelEditingTitle,
    onTitleKeyDown,
    onTitleBlur,
  }
}
