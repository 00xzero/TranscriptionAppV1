"use client"

import { useEffect } from 'react'
import {
  useRecordingActions,
  useRecordingSession,
} from '@/lib/recording/RecordingSessionContext'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useRecordingTitleEditing } from './useRecordingTitleEditing'

// Recording-page fonts (kept distinct from the editor's italic 4xl/5xl title).
const TITLE_CLASSES = 'font-serif text-3xl text-ink dark:text-paper'
const TITLE_EDIT_HINT_ID = 'recording-title-edit-hint'

export default function RecordingTitle() {
  const snapshot = useRecordingSession()
  const actions = useRecordingActions()

  const displayTitle =
    snapshot.title ?? snapshot.generatedTitle ?? 'Untitled recording'
  const editable = snapshot.state === 'recording' || snapshot.state === 'paused'

  const {
    editingTitle,
    titleInput,
    setTitleInput,
    titleInputRef,
    startEditingTitle,
    cancelEditingTitle,
    onTitleKeyDown,
    onTitleBlur,
  } = useRecordingTitleEditing({
    title: snapshot.title,
    onSave: actions.updateSessionTitle,
  })

  useEffect(() => {
    if (!editable && editingTitle) {
      cancelEditingTitle()
    }
  }, [cancelEditingTitle, editable, editingTitle])

  if (editingTitle && editable) {
    return (
      <input
        ref={titleInputRef}
        data-testid="recording-title-input"
        className={`${TITLE_CLASSES} bg-transparent border-b-2 border-trust-blue px-1 py-0.5 min-w-[280px] focus:outline-hidden`}
        value={titleInput}
        onChange={(e) => setTitleInput(e.target.value)}
        onKeyDown={onTitleKeyDown}
        onBlur={onTitleBlur}
        placeholder={snapshot.generatedTitle ?? 'Recording title'}
        aria-label="Recording title"
      />
    )
  }

  if (!editable) {
    return (
      <h1 data-testid="recording-title" className={TITLE_CLASSES}>
        {displayTitle}
      </h1>
    )
  }

  return (
    // Self-contained provider so the component works on any route regardless of a
    // surrounding TooltipProvider (the app layout also provides one; nesting is fine).
    <TooltipProvider delayDuration={700}>
      <span id={TITLE_EDIT_HINT_ID} className="sr-only">
        Press Enter or Space to edit title
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <h1
            data-testid="recording-title"
            className={`${TITLE_CLASSES} cursor-pointer hover:text-trust-blue transition-colors`}
            onClick={startEditingTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                startEditingTitle()
              }
            }}
            tabIndex={0}
            role="button"
            aria-describedby={TITLE_EDIT_HINT_ID}
          >
            {displayTitle}
          </h1>
        </TooltipTrigger>
        <TooltipContent>Click to edit title</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
