import React from 'react'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTranscriptDate, formatDurationHHMMSS } from '../utils'

export default function EditorHeader({
  transcriptId,
  transcriptTitle,
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
}: {
  transcriptId: string
  transcriptTitle: string | null
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
              className={`font-serif italic text-4xl md:text-5xl tracking-tight bg-transparent border-b-2 px-1 py-0.5 text-ink dark:text-paper min-w-[300px] focus:outline-hidden mb-4 ${titleSaveError ? 'border-ember-red' : 'border-trust-blue'}`}
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={onTitleBlur}
              placeholder="Transcript title"
              aria-label="Transcript title"
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
                  {transcriptTitle || `Untitled (${transcriptId.slice(0, 8)}...)`}
                </h1>
              </TooltipTrigger>
              <TooltipContent>Click to edit title</TooltipContent>
            </Tooltip>
          )}
        </div>
        {titleSaveError && (
          <span className="text-sm text-ember-red">{titleSaveError}</span>
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
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-warm-highlight/50 dark:hover:bg-night-border/80 text-ink/40 dark:text-paper/40 transition-colors shrink-0"
                    aria-label="Transcript options"
                  >
                    <span className="text-lg leading-none">&#8942;</span>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More options</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-ember-red focus:text-ember-red focus:bg-warm-highlight/70 dark:focus:bg-night-border"
                onSelect={onDeleteClick}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Separator decorative={false} className="mt-8 bg-ink/10 dark:bg-white/10" />
    </div>
  )
}
