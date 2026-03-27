import React from 'react'
import { formatProjectDate, formatDurationHHMMSS } from '../utils'

export default function EditorHeader({
  projectId,
  projectTitle,
  projectCreatedAt,
  projectDurationSecs,
  uniqueSpeakerCount,
  status,
  editingTitle,
  titleInput,
  setTitleInput,
  titleInputRef,
  titleSaveError,
  startEditingTitle,
  onTitleKeyDown,
  onTitleBlur,
}: {
  projectId: string
  projectTitle: string | null
  projectCreatedAt: string | null
  projectDurationSecs: number | null
  uniqueSpeakerCount: number
  status: string
  editingTitle: boolean
  titleInput: string
  setTitleInput: (v: string) => void
  titleInputRef: React.RefObject<HTMLInputElement | null>
  titleSaveError: string | null
  startEditingTitle: () => void
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onTitleBlur: () => void
}) {
  const showStatusInMetaRow = status !== 'Ready'
  const isStatusError = status.startsWith('Error:')

  return (
    <div className="px-6 md:px-20 pt-10 pb-6">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className={`font-serif italic text-4xl md:text-5xl tracking-tight bg-transparent border-b-2 px-1 py-0.5 text-ink dark:text-[#EAEAEA] min-w-[300px] focus:outline-none mb-4 ${titleSaveError ? 'border-ember-red' : 'border-trust-blue'}`}
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={onTitleBlur}
              placeholder="Project title"
              aria-label="Project title"
            />
          ) : (
            <h1
              className="font-serif italic text-4xl md:text-5xl tracking-tight text-ink dark:text-[#EAEAEA] cursor-pointer hover:text-trust-blue transition-colors mb-4"
              onClick={startEditingTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  startEditingTitle()
                }
              }}
              tabIndex={0}
              role="button"
              aria-label="Edit title"
              title="Click to edit title"
            >
              {projectTitle || `Untitled (${projectId.slice(0, 8)}...)`}
            </h1>
          )}
        </div>
        {titleSaveError && (
          <span className="text-sm text-ember-red">{titleSaveError}</span>
        )}
        <div className="flex items-center gap-4 text-xs font-mono uppercase tracking-wider text-ink/50 dark:text-paper/40">
          {showStatusInMetaRow ? (
            <span className={isStatusError ? 'text-ember-red/90 dark:text-ember-red/90' : ''}>
              {status}
            </span>
          ) : (
            <>
              {projectCreatedAt && (
                <>
                  <span>{formatProjectDate(projectCreatedAt)}</span>
                  <span>&bull;</span>
                </>
              )}
              <span>{uniqueSpeakerCount} speaker{uniqueSpeakerCount !== 1 ? 's' : ''}</span>
              {projectDurationSecs !== null && (
                <>
                  <span>&bull;</span>
                  <span>{formatDurationHHMMSS(projectDurationSecs)}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="h-px w-full bg-ink/10 dark:bg-white/10 mt-8" />
    </div>
  )
}
