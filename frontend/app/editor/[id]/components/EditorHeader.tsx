import React, { useId } from 'react'
import { TEXT_LIMITS } from '@/contracts/limits'
import { CharacterCount } from '@/components/ui/character-count'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TranscriptActionsMenu } from '@/components/TranscriptActionsMenu'
import { formatTranscriptDate } from '../utils'
import { formatClockTime } from '@/lib/utils'

export default function EditorHeader({
  displayTitle,
  transcriptCreatedAt,
  transcriptDurationSecs,
  speakerSummary,
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
  /** The speaker summary button, after the date and duration. */
  speakerSummary?: React.ReactNode
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
  const titleEditHintId = useId()
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
            <>
              <span id={titleEditHintId} className="sr-only">Press Enter or Space to edit title</span>
              <h1 className="font-serif italic text-4xl md:text-5xl tracking-tight text-ink dark:text-paper mb-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer text-left hover:text-trust-blue transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={startEditingTitle}
                      aria-describedby={titleEditHintId}
                    >
                      {displayTitle}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Click to edit title</TooltipContent>
                </Tooltip>
              </h1>
            </>
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
                    {transcriptDurationSecs !== null && <span>&bull;</span>}
                  </>
                )}
                {transcriptDurationSecs !== null && <span>{formatClockTime(transcriptDurationSecs, 'always')}</span>}
                {/* No bullet before the faces: they set themselves apart, and on a
                    narrow screen, where they wrap, a bullet would be left dangling. */}
                {speakerSummary}
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
