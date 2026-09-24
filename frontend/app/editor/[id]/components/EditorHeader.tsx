import React, { useId } from 'react'
import { TEXT_LIMITS } from '@/contracts/limits'
import { CharacterCount } from '@/components/ui/character-count'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { formatTranscriptDate, formatDurationHHMMSS } from '../utils'

export default function EditorHeader({
  displayTitle,
  transcriptCreatedAt,
  transcriptDurationSecs,
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
  onDeleteClick,
  onMoveClick,
}: {
  displayTitle: string
  transcriptCreatedAt: string | null
  transcriptDurationSecs: number | null
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
  onDeleteClick: () => void
  onMoveClick: () => void
}) {
  const titleCountId = useId()
  const showStatusInMetaRow = status !== 'Ready'
  const isStatusError = status.startsWith('Error:')

  return (
    <div className="px-6 md:px-20 pt-10 pb-6">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className={`font-serif italic text-4xl md:text-5xl tracking-tight bg-transparent border-b-2 px-1 py-0.5 text-ink dark:text-paper min-w-[300px] focus:outline-hidden mb-4 ${titleSaveError ? 'border-ember-red' : 'border-trust-blue'}`}
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={onTitleBlur}
              placeholder="Transcript title"
              aria-label="Transcript title"
              aria-describedby={titleCountId}
              aria-invalid={titleSaveError ? true : undefined}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <h1
                  className="font-serif italic text-4xl md:text-5xl tracking-tight text-ink dark:text-paper cursor-pointer hover:text-trust-blue transition-colors mb-4"
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
                >
                  {displayTitle}
                </h1>
              </TooltipTrigger>
              <TooltipContent>Click to edit title</TooltipContent>
            </Tooltip>
          )}
        </div>
        {editingTitle && (
          <CharacterCount id={titleCountId} length={titleInput.trim().length} max={TEXT_LIMITS.transcriptTitle} className="-mt-2 mb-2" />
        )}
        {titleSaveError && (
          <span role="alert" className="text-sm text-ember-red">{titleSaveError}</span>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1 flex-wrap text-xs font-mono uppercase tracking-wider text-ink/50 dark:text-paper/40">
            {showStatusInMetaRow ? (
              <span className={isStatusError ? 'text-ember-red/90 dark:text-ember-red/90' : ''}>
                {status}
              </span>
            ) : (
              <>
                {transcriptCreatedAt && (
                  <>
                    <span>{formatTranscriptDate(transcriptCreatedAt)}</span>
                    <span>&bull;</span>
                  </>
                )}
                <span>{uniqueSpeakerCount} speaker{uniqueSpeakerCount !== 1 ? 's' : ''}</span>
                {transcriptDurationSecs !== null && (
                  <>
                    <span>&bull;</span>
                    <span>{formatDurationHHMMSS(transcriptDurationSecs)}</span>
                  </>
                )}
              </>
            )}
          </div>
          <TranscriptActionsMenu
            title={displayTitle}
            onMove={onMoveClick}
            onDelete={onDeleteClick}
          />
        </div>
      </div>
      <Separator decorative={false} className="mt-8 bg-subtle-hover" />
    </div>
  )
}
