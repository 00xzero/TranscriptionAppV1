import { useCallback, useRef, useState } from 'react'
import { updateProject } from '@/lib/supabase/queries'

export function useProjectTitleEditing({
  projectId,
  projectTitle,
  setProjectTitle,
}: {
  projectId: string
  projectTitle: string | null
  setProjectTitle: (title: string | null) => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const isSavingTitleRef = useRef(false)

  const startEditingTitle = useCallback(() => {
    setTitleInput(projectTitle || '')
    setTitleSaveError(null)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [projectTitle])

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
      await updateProject(projectId, { title: newTitle })
      setProjectTitle(newTitle)
      setEditingTitle(false)
    } catch (err) {
      console.error('Failed to save title:', err)
      setTitleSaveError('Failed to save title. Please try again.')
    } finally {
      isSavingTitleRef.current = false
    }
  }, [titleInput, projectId, setProjectTitle])

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
