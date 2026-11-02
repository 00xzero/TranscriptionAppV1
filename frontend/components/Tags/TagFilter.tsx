'use client'

import { useMemo, useRef, useState } from 'react'
import { ColourPicker } from '@/components/ColourPicker'
import { FilterChips } from '@/components/FilterChips'
import { PersonNameDialog } from '@/components/People/PersonNameDialog'
import { DestructiveMenuItem, RowActionsMenu } from '@/components/RowActionsMenu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAnchoredFocusReturn } from '@/lib/hooks/useAnchoredFocusReturn'
import type { Tag } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import { exactByName } from '@/core/names'
import { useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { useTagActions } from '@/lib/tags/actions'
import { useTags } from '@/lib/tags/TagsProvider'
import { TagConfirmDialog, type TagConfirm } from './TagConfirmDialog'

/**
 * A list's tag filter state. Selected tags that no longer exist drop out, as
 * deleted organisations do in People. With none selected everything matches;
 * otherwise a transcript matches when it carries any selected tag.
 */
export function useTagFilter() {
  const store = useTags()
  const [chosen, setChosen] = useState<string[]>([])
  const selected = chosen.filter((tagId) => store.tag(tagId))
  return {
    selected,
    setSelected: setChosen,
    clear: () => setChosen([]),
    active: selected.length > 0,
    matches: (transcriptId: string) =>
      selected.length === 0 || store.tagsOf(transcriptId).some((tag) => selected.includes(tag.id)),
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

/**
 * All, then each tag the listed transcripts carry, with how many it would
 * list. While exactly one tag is on, its ⋯ menu renames, recolours or deletes
 * it everywhere. Hidden while none of the listed transcripts has a tag.
 */
export function TagFilter({ transcriptIds, selected, onChange }: {
  transcriptIds: readonly string[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
}) {
  const store = useTags()
  const actions = useTagActions()
  const { transcripts } = useTranscriptsData()
  const listed = useMemo(() => new Set(transcriptIds), [transcriptIds])
  const everywhere = useMemo(() => new Set(transcripts.map((transcript) => transcript.id)), [transcripts])
  const [renaming, setRenaming] = useState<Tag | null>(null)
  const [confirm, setConfirm] = useState<TagConfirm>(null)

  const options = store.tags
    .map((tag) => ({ tag, count: store.countFor(tag.id, listed) }))
    .filter(({ tag, count }) => count > 0 || selected.includes(tag.id))
    .map(({ tag, count }) => ({ value: tag.id, label: tag.name, count, color: tag.color }))
  if (options.length === 0 && !renaming && !confirm) return null
  const countOf = (tagId: string) => store.countFor(tagId, everywhere)

  return (
    <>
      <FilterChips
        label="Tags"
        total={transcriptIds.length}
        options={options}
        selected={selected}
        onChange={onChange}
        menu={(value) => {
          const tag = store.tag(value)
          return tag && (
            <TagFilterMenu
              tag={tag}
              onRename={() => setRenaming(tag)}
              onRecolour={(color) => actions.recolour(tag, color)}
              onDelete={() => setConfirm({ kind: 'delete', tag })}
            />
          )
        }}
      />
      {renaming && (
        <PersonNameDialog
          onOpenChange={(open) => { if (!open) setRenaming(null) }}
          title="Rename tag"
          description={`Every transcript tagged ${renaming.name} shows the new name.`}
          label="Tag name"
          initialName={renaming.name}
          maxLength={TEXT_LIMITS.tagName}
          subject="tag"
          submitLabel={(name) => (exactByName(store.tags.filter((tag) => tag.id !== renaming.id), name) ? 'Merge…' : 'Rename')}
          pendingLabel="Renaming…"
          onSubmit={async (name) => {
            const clash = exactByName(store.tags.filter((tag) => tag.id !== renaming.id), name)
            if (clash) {
              setConfirm({ kind: 'merge', from: renaming, into: clash })
              return
            }
            await actions.rename(renaming, name)
          }}
        >
          {(name) => {
            const clash = exactByName(store.tags.filter((tag) => tag.id !== renaming.id), name)
            return clash && (
              <p className="rounded-sm border border-border bg-subtle px-3 py-2 text-xs text-muted">
                “{clash.name}” already exists. Saving offers to merge them.
              </p>
            )
          }}
        </PersonNameDialog>
      )}
      <TagConfirmDialog
        confirm={confirm}
        countOf={countOf}
        onClose={() => setConfirm(null)}
        onDelete={actions.delete}
        onMerge={actions.merge}
      />
    </>
  )
}

function TagFilterMenu({ tag, onRename, onRecolour, onDelete }: {
  tag: Tag
  onRename: () => void
  onRecolour: (color: string) => Promise<void>
  onDelete: () => void
}) {
  const [colourOpen, setColourOpen] = useState(false)
  // Set while the menu closes for Change colour…, so it doesn't hand focus back to its button.
  const openingColour = useRef(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const focusReturn = useAnchoredFocusReturn(anchor)

  return (
    <Popover open={colourOpen} onOpenChange={setColourOpen}>
      <PopoverAnchor asChild>
        <span ref={anchor} className="inline-flex">
          <RowActionsMenu
            label={tag.name}
            onCloseAutoFocus={(event) => {
              if (!openingColour.current) return
              openingColour.current = false
              event.preventDefault()
              setColourOpen(true)
            }}
          >
            <DropdownMenuItem onSelect={onRename}>Rename tag…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { openingColour.current = true }}>Change colour…</DropdownMenuItem>
            <DestructiveMenuItem onSelect={onDelete}>Delete tag…</DestructiveMenuItem>
          </RowActionsMenu>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-64"
        // The picker has no trigger of its own: hand focus back to the tag's ⋯ button.
        {...focusReturn}
      >
        <ColourPicker
          current={tag.color}
          onChoose={(color) => onRecolour(color).then(() => setColourOpen(false))}
          describeError={messageOf}
        />
      </PopoverContent>
    </Popover>
  )
}
