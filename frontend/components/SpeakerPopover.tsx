"use client"
import React, { useState, useRef, useEffect, useMemo } from 'react'
import type { Speaker } from '../lib/supabase/types'

type SpeakerPopoverProps = {
  /** All speakers in the project */
  speakers: Speaker[]
  /** The speaker currently assigned to this segment (if any) */
  currentSpeaker?: Speaker
  /** Position to render the popover */
  anchorRect: DOMRect | null
  /** Called when user selects an existing speaker (reassign segment) */
  onSelectSpeaker: (speaker: Speaker) => void
  /** Called when user creates a new speaker (create + reassign) */
  onCreateSpeaker: (label: string) => void
  /** Called when user renames current speaker (global rename) */
  onRenameSpeaker: (speaker: Speaker, newLabel: string) => void
  /** Called when user untags (resets speaker label to default) */
  onUntag: (speaker: Speaker) => void
  /** Called when popover should close */
  onClose: () => void
  /** Optional color getter for consistent colors with parent */
  getColorForSpeaker?: (speaker?: Speaker) => string
}

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#14B8A6', '#8B5CF6', '#F472B6', '#22C55E', '#EAB308', '#0EA5E9']

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

export default function SpeakerPopover({
  speakers,
  currentSpeaker,
  anchorRect,
  onSelectSpeaker,
  onCreateSpeaker,
  onRenameSpeaker,
  onUntag,
  onClose,
  getColorForSpeaker: getColorForSpeakerProp,
}: SpeakerPopoverProps) {
  // Use provided color function or fallback to local hash-based one
  const getSpeakerColor = getColorForSpeakerProp || getColorForSpeaker
  const [searchValue, setSearchValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter speakers based on search
  const filteredSpeakers = useMemo(() => {
    if (!searchValue.trim()) return speakers
    const needle = searchValue.toLowerCase()
    return speakers.filter(sp => sp.label.toLowerCase().includes(needle))
  }, [speakers, searchValue])

  // Check if search value matches an existing speaker exactly
  const exactMatch = useMemo(() => {
    const needle = searchValue.trim().toLowerCase()
    return speakers.find(sp => sp.label.toLowerCase() === needle)
  }, [speakers, searchValue])

  // Check if current speaker has a custom name (not "Speaker X" format)
  const isCurrentSpeakerNamed = useMemo(() => {
    if (!currentSpeaker) return false
    return !/^Speaker\s+\d+$/i.test(currentSpeaker.label)
  }, [currentSpeaker])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Calculate position with viewport boundary detection
  const [position, setPosition] = useState<{ top: number; left: number; flipUp: boolean }>({ top: 0, left: 0, flipUp: false })

  useEffect(() => {
    if (!anchorRect) return

    const POPOVER_HEIGHT = 320 // Approximate max height of popover
    const GAP = 8
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Check if there's enough space below
    const spaceBelow = viewportHeight - anchorRect.bottom - GAP
    const spaceAbove = anchorRect.top - GAP
    const flipUp = spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow

    // Calculate top position
    let top: number
    if (flipUp) {
      top = anchorRect.top - GAP - Math.min(POPOVER_HEIGHT, spaceAbove)
    } else {
      top = anchorRect.bottom + GAP
    }

    // Ensure left doesn't go off-screen (popover is 288px wide)
    let left = anchorRect.left
    if (left + 288 > viewportWidth) {
      left = viewportWidth - 288 - 16
    }
    if (left < 16) left = 16

    setPosition({ top, left, flipUp })
  }, [anchorRect])

  const style: React.CSSProperties = useMemo(() => {
    if (!anchorRect) return { display: 'none' }
    return {
      position: 'fixed',
      top: position.top,
      left: position.left,
      zIndex: 1000,
      maxHeight: position.flipUp ? `${anchorRect.top - 16}px` : `${window.innerHeight - anchorRect.bottom - 16}px`,
    }
  }, [anchorRect, position])

  const handleTagClick = () => {
    const trimmed = searchValue.trim()
    if (!trimmed) return

    if (exactMatch) {
      // Select existing speaker (reassign)
      onSelectSpeaker(exactMatch)
    } else {
      // Create new speaker
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
      // Clicking current speaker - start editing to rename
      setEditingId(speaker.id)
      setEditValue(speaker.label)
    } else {
      // Clicking different speaker - reassign
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

  if (!anchorRect) return null

  return (
    <div
      ref={popoverRef}
      style={style}
      className="bg-surface border border-base rounded-lg shadow-lg w-72 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-base bg-surface-alt shrink-0">
        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Suggested Speakers
        </span>
      </div>

      {/* Speaker list */}
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
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${isCurrentSp ? 'bg-accent-soft' : 'hover:bg-surface-alt focus:bg-surface-alt'
                  }`}
                onClick={() => !isEditing && handleSpeakerClick(sp)}
                onKeyDown={e => {
                  if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    handleSpeakerClick(sp)
                  }
                }}
              >
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>

                {/* Name or edit input */}
                {isEditing ? (
                  <input
                    type="text"
                    className="flex-1 px-2 py-1 text-sm border border-base rounded bg-surface"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(sp)}
                    onKeyDown={e => handleRenameKeyDown(e, sp)}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-sm truncate">{sp.label}</span>
                )}

                {/* Current indicator or edit hint */}
                {isCurrentSp && !isEditing && (
                  <span className="text-[10px] text-muted bg-surface-alt px-2 py-0.5 rounded">
                    Click to rename
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Input section */}
      <div className="border-t border-base p-3 space-y-2 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="flex-1 px-3 py-1.5 text-sm border border-base rounded bg-surface placeholder:text-muted"
            placeholder="Type speaker's name here"
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="px-3 py-1.5 text-sm font-medium rounded bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!searchValue.trim()}
            onClick={handleTagClick}
          >
            Tag
          </button>
        </div>

        {/* Untag option for named speakers */}
        {currentSpeaker && isCurrentSpeakerNamed && (
          <button
            className="w-full text-left text-xs text-muted hover:text-current transition-colors flex items-center gap-2"
            onClick={handleUntag}
          >
            <span className="text-red-500">✕</span>
            <span>Reset to generic name</span>
          </button>
        )}
      </div>
    </div>
  )
}
