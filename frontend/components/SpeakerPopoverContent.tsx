"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Speaker } from '@/contracts/db'

type SpeakerPopoverContentProps = {
  speakers: Speaker[]
  currentSpeaker?: Speaker
  onSelectSpeaker: (speaker: Speaker) => void
  onCreateSpeaker: (label: string) => void
  onRenameSpeaker: (speaker: Speaker, newLabel: string) => void
  onUntag: (speaker: Speaker) => void
  getColorForSpeaker?: (speaker?: Speaker) => string
}

// Colors aligned with Olivetti prototype: trust-blue, ember-red, yellow-600 first, then brand-complementary
const COLORS = ['#4F638C', '#C73E1D', '#A16207', '#0D9488', '#7C3AED', '#64748B', '#B45309', '#059669', '#DB2777', '#2563EB']

function getColorForSpeaker(speaker?: Speaker): string {
  if (speaker?.color) return speaker.color
  const key = speaker?.id || speaker?.label || 'unknown'
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return COLORS[hash % COLORS.length]
}

function getInitials(name: string): string {
  const parts = (name || 'U').trim().split(/\s+/)
  const first = parts[0]?.[0] || ''
  const second = parts[1]?.[0] || ''
  return (first + second || 'U').toUpperCase()
}

export default function SpeakerPopoverContent({
  speakers,
  currentSpeaker,
  onSelectSpeaker,
  onCreateSpeaker,
  onRenameSpeaker,
  onUntag,
  getColorForSpeaker: getColorForSpeakerProp,
}: SpeakerPopoverContentProps) {
  const getSpeakerColor = getColorForSpeakerProp || getColorForSpeaker
  const [searchValue, setSearchValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  const handleTagClick = () => {
    const trimmed = searchValue.trim()
    if (!trimmed) return

    if (exactMatch) {
      onSelectSpeaker(exactMatch)
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
    } else {
      onSelectSpeaker(speaker)
    }
  }

  const handleRenameSubmit = (speaker: Speaker) => {
    const trimmed = editValue.trim()
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
      <div className="border-b border-base bg-surface-alt px-3 py-2 shrink-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Suggested Speakers
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredSpeakers.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted text-center">
            No speakers found
          </div>
        ) : (
          filteredSpeakers.map(sp => {
            const isCurrentSp = sp.id === currentSpeaker?.id
            const color = getSpeakerColor(sp)
            const initials = getInitials(sp.label)
            const isEditing = editingId === sp.id

            return (
              <div
                key={sp.id}
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
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>

                {isEditing ? (
                  <input
                    type="text"
                    className="flex-1 px-2 py-1 text-sm border border-base rounded-sm bg-surface"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(sp)}
                    onKeyDown={e => handleRenameKeyDown(e, sp)}
                    aria-label={`Rename speaker ${sp.label}`}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-sm truncate">{sp.label}</span>
                )}

                {isCurrentSp && !isEditing && (
                  <span className="text-[10px] text-muted bg-surface-alt px-2 py-0.5 rounded-sm">
                    Click to rename
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-base p-3 space-y-2 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="flex-1 px-3 py-1.5 text-sm border border-base rounded-sm bg-surface placeholder:text-muted"
            placeholder="Type speaker's name here"
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search speakers or type a new speaker name"
          />
          <button
            type="button"
            className="px-3 py-1.5 text-sm font-medium rounded-sm bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!searchValue.trim()}
            onClick={handleTagClick}
            title="Tag speaker"
          >
            Tag
          </button>
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
