import { useCallback, useEffect, useRef, useState } from 'react'
import { updateTranscriptTitleGuarded } from '@/lib/supabase/queries'
import { TRANSCRIPT_TITLE_TOO_LONG, transcriptTitleTooLong } from '@/core/transcripts/title'
import type { Send } from '@/lib/editor/untilAnswered'
import { changedSince } from '@/lib/people/errors'
import type { EditorHistory, HistoryStep } from './useEditorHistory'
import type { SegmentHolds } from './useSegmentHolds'

/**
 * Inline title editing, as steps of the editor's history. A save takes its
 * place in the history the moment it is asked for (Enter, or the field losing
 * focus, as a click on Undo does), and is written through the write queue.
 */
export function useTranscriptTitleEditing({
  transcriptId,
  transcriptTitle,
  setTranscriptTitle,
  onTitleSaved,
  send,
  history,
  holds,
}: {
  transcriptId: string
  transcriptTitle: string | null
  setTranscriptTitle: (title: string | null) => void
  onTitleSaved: (title: string) => void
  send: Send
  history: EditorHistory
  holds: SegmentHolds
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [saveFailure, setSaveFailure] = useState<string | null>(null)
  const [tooLongSaveBlocked, setTooLongSaveBlocked] = useState(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const { blocked, has: held } = holds
  const { original } = history
  // The title as the database holds it, as far as this editor knows.
  const current = useRef(transcriptTitle)
  useEffect(() => { current.current = transcriptTitle }, [transcriptTitle])

  const startEditingTitle = useCallback(() => {
    if (blocked(['title'])) return
    setTitleInput(current.current || '')
    setSaveFailure(null)
    setTooLongSaveBlocked(false)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }, [blocked])

  const saveTitle = useCallback(() => {
    // A save already waiting holds the title until it has run.
    if (held('title')) return

    const after = titleInput.trim()
    if (!after || after === current.current) {
      setEditingTitle(false)
      setSaveFailure(null)
      return
    }
    // Over the limit: keep the field open with the typed text; Escape cancels.
    if (transcriptTitleTooLong(after)) {
      setTooLongSaveBlocked(true)
      return
    }

    const before = current.current
    setSaveFailure(null)

    // Runs inside the write queue, expecting the title it replaces.
    const write = async (expected: string | null, title: string | null) => {
      if (current.current !== expected) throw changedSince('The title changed since')
      const row = await send(() => updateTranscriptTitleGuarded(transcriptId, expected, title))
      current.current = row.title
      setTranscriptTitle(row.title)
      onTitleSaved(row.title ?? '')
    }
    const step: HistoryStep = {
      label: 'title', failure: "Couldn't rename the transcript", scope: 'title', touches: ['title'], target: () => ({ title: true }),
      async run(dir, applied) {
        await write(dir === 'undo' ? after : before, dir === 'undo' ? before : after)
        applied()
      },
    }
    const perform = async () => {
      await write(before, after)
      setEditingTitle(false)
    }
    original(step, perform, (error) => {
      console.error('Failed to save title:', error)
      setSaveFailure('Failed to save title. Please try again.')
    })
  }, [held, titleInput, send, transcriptId, setTranscriptTitle, onTitleSaved, original])

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

  const onTitleBlur = useCallback(() => saveTitle(), [saveTitle])

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
