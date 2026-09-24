"use client"

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Speaker } from '@/contracts/db'
import { speakerInitials } from '@/lib/speakers/palette'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CharacterCount } from '@/components/ui/character-count'
import { TEXT_LIMITS } from '@/contracts/limits'

const SPEAKER_NAME_TOO_LONG = `Speaker names must be ${TEXT_LIMITS.speakerName} characters or fewer.`

function speakerNameTooLong(name: string) {
  return name.trim().length > TEXT_LIMITS.speakerName
}

type SpeakerPopoverContentProps = {
  speakers: Speaker[]
  currentSpeaker?: Speaker
  onSelectSpeaker: (speaker: Speaker) => void
  onCreateSpeaker: (label: string) => void
  onRenameSpeaker: (speaker: Speaker, newLabel: string) => void
  onUntag: (speaker: Speaker) => void
  /**
   * Required, not optional: the transcript's palette positions live in
   * useSpeakerAssignments, and a local default here would be a second, divergent
   * color rule. Keeping it mandatory means the popover cannot be rendered
   * without the transcript-wide map.
   */
  getColorForSpeaker: (speaker?: Speaker) => string
  /**
   * Reports whether a typed name is over the length limit, so the popover can
   * refuse to close on an outside click and discard it. Escape still cancels.
   */
  onHoldOpenChange?: (hold: boolean) => void
}

export default function SpeakerPopoverContent({
  speakers,
  currentSpeaker,
  onSelectSpeaker,
  onCreateSpeaker,
  onRenameSpeaker,
  onUntag,
  getColorForSpeaker,
  onHoldOpenChange,
}: SpeakerPopoverContentProps) {
  const [searchValue, setSearchValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const newNameCountId = useId()
  const renameCountId = useId()
  // Set when a save was refused; the errors clear themselves once the name fits.
  const [tagBlocked, setTagBlocked] = useState(false)
  const [renameBlocked, setRenameBlocked] = useState(false)
  const newNameTooLong = speakerNameTooLong(searchValue)
  const renameTooLong = editingId !== null && speakerNameTooLong(editValue)
  const holdOpen = newNameTooLong || renameTooLong

  const filteredSpeakers = useMemo(() => {
    if (!searchValue.trim()) return speakers
    const needle = searchValue.toLowerCase()
    return speakers.filter(sp => sp.label.toLowerCase().includes(needle))
  }, [speakers, searchValue])

  const exactMatch = useMemo(() => {
    const needle = searchValue.trim().toLowerCase()
    return speakers.find(sp => sp.label.toLowerCase() === needle)
  }, [speakers, searchValue])

  const isCurrentSpeakerNamed = useMemo(() => {
    if (!currentSpeaker) return false
    return !/^Speaker\s+\d+$/i.test(currentSpeaker.label)
  }, [currentSpeaker])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    onHoldOpenChange?.(holdOpen)
  }, [holdOpen, onHoldOpenChange])

  const handleTagClick = () => {
    const trimmed = searchValue.trim()
    if (!trimmed) return

    if (exactMatch) {
      onSelectSpeaker(exactMatch)
    } else if (speakerNameTooLong(trimmed)) {
      setTagBlocked(true)
      return
    } else {
      onCreateSpeaker(trimmed)
    }
    setSearchValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTagClick()
    }
  }

  const handleSpeakerClick = (speaker: Speaker) => {
    if (speaker.id === currentSpeaker?.id) {
      setEditingId(speaker.id)
      setEditValue(speaker.label)
      setRenameBlocked(false)
    } else {
      onSelectSpeaker(speaker)
    }
  }

  const handleRenameSubmit = (speaker: Speaker) => {
    const trimmed = editValue.trim()
    // Over the limit: stay in edit mode (blur included) with the typed text.
    if (speakerNameTooLong(trimmed)) {
      setRenameBlocked(true)
      return
    }
    if (trimmed && trimmed !== speaker.label) {
      onRenameSpeaker(speaker, trimmed)
    }
    setEditingId(null)
    setEditValue('')
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent, speaker: Speaker) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit(speaker)
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditValue('')
    }
  }

  const handleUntag = () => {
    if (currentSpeaker) {
      onUntag(currentSpeaker)
    }
  }

  return (
    <div className="flex max-h-[var(--radix-popover-content-available-height)] min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border bg-surface-alt px-3 py-2 shrink-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Suggested Speakers
        </span>
      </div>

      <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
        {filteredSpeakers.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted text-center">
            No speakers found
          </div>
        ) : (
          filteredSpeakers.map(sp => {
            const isCurrentSp = sp.id === currentSpeaker?.id
            const color = getColorForSpeaker(sp)
            const initials = speakerInitials(sp.label)
            const isEditing = editingId === sp.id

            return (
              <React.Fragment key={sp.id}>
                <div
                  role="button"
                  tabIndex={isEditing ? -1 : 0}
                  aria-label={isCurrentSp ? `Current speaker ${sp.label}. Activate to rename` : `Assign speaker ${sp.label}`}
                  title={isCurrentSp ? `Rename ${sp.label}` : `Assign ${sp.label}`}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors focus:outline-hidden focus:ring-2 focus:ring-accent ${isCurrentSp ? 'bg-accent-soft' : 'hover:bg-surface-alt focus:bg-surface-alt'
                    }`}
                  onClick={() => !isEditing && handleSpeakerClick(sp)}
                  onKeyDown={e => {
                    if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      handleSpeakerClick(sp)
                    }
                  }}
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-solid-foreground"
                    style={{ backgroundColor: color }}
                  >
                    {initials}
                  </div>

                  {isEditing ? (
                    <>
                      <Input
                        type="text"
                        className="min-w-0 flex-1 bg-surface px-2 py-1"
                        aria-describedby={renameCountId}
                        aria-invalid={renameTooLong ? true : undefined}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => handleRenameSubmit(sp)}
                        onKeyDown={e => handleRenameKeyDown(e, sp)}
                        aria-label={`Rename speaker ${sp.label}`}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                      <CharacterCount id={renameCountId} length={editValue.trim().length} max={TEXT_LIMITS.speakerName} />
                    </>
                  ) : (
                    <span className="flex-1 text-sm truncate">{sp.label}</span>
                  )}

                  {isCurrentSp && !isEditing && (
                    <span className="text-[10px] text-muted bg-surface-alt px-2 py-0.5 rounded-sm">
                      Click to rename
                    </span>
                  )}
                </div>
                {isEditing && renameBlocked && renameTooLong && (
                  <p role="alert" className="px-3 pb-2 text-xs text-ember-red">{SPEAKER_NAME_TOO_LONG}</p>
                )}
              </React.Fragment>
            )
          })
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2 shrink-0">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            type="text"
            className="flex-1 bg-surface py-1.5 placeholder:text-muted"
            placeholder="Type speaker's name here"
            aria-describedby={newNameCountId}
            aria-invalid={newNameTooLong ? true : undefined}
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search speakers or type a new speaker name"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="text-sm"
            disabled={!searchValue.trim()}
            onClick={handleTagClick}
            title="Tag speaker"
          >
            Tag
          </Button>
        </div>
        <div className="flex items-start justify-between gap-3">
          {tagBlocked && newNameTooLong ? (
            <p role="alert" className="text-xs text-ember-red">{SPEAKER_NAME_TOO_LONG}</p>
          ) : (
            <span />
          )}
          <CharacterCount id={newNameCountId} length={searchValue.trim().length} max={TEXT_LIMITS.speakerName} />
        </div>

        {currentSpeaker && isCurrentSpeakerNamed && (
          <button
            type="button"
            className="w-full text-left text-xs text-muted hover:text-current transition-colors flex items-center gap-2"
            onClick={handleUntag}
            aria-label="Reset speaker to a generic name"
            title="Reset to generic name"
          >
            <span className="text-red-500">✕</span>
            <span>Reset to generic name</span>
          </button>
        )}
      </div>
    </div>
  )
}
