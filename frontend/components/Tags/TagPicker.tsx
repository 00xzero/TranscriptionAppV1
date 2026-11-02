'use client'

import { useId, useRef, useState, type RefObject } from 'react'
import { Check, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { ColourPicker } from '@/components/ColourPicker'
import { nameLength } from '@/components/People/format'
import { countLabel } from '@/components/Projects/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Tag } from '@/contracts/db'
import { TEXT_LIMITS } from '@/contracts/limits'
import { exactByName, matchByName, sameName } from '@/core/names'
import { useListboxKeys } from '@/lib/hooks/useListboxKeys'
import { newTagColor } from '@/lib/tags/actions'
import { cn } from '@/lib/utils'
import { TagChip } from './TagChip'
import { TagConfirmDialog, type TagConfirm } from './TagConfirmDialog'

const LIMIT = TEXT_LIMITS.tagName

/** What the tag box does. Link writes return at once; tag-level ones reject with a message to show. */
export type TagPickerHandlers = {
  onAdd: (tag: Tag) => void
  onRemove: (tag: Tag) => void
  onCreate: (name: string) => void
  onRename: (tag: Tag, name: string) => Promise<void>
  onRecolour: (tag: Tag, color: string) => Promise<void>
  onDelete: (tag: Tag) => Promise<void>
  onMerge: (from: Tag, into: Tag) => Promise<void>
}

/** Whether the tags have loaded: the box waits, offers Retry, or works. */
export type TagLoadState = 'loading' | 'failed' | 'ready'

/** A store's load state as the tag box shows it. */
export function tagLoadState(store: { loaded: boolean; error: unknown }): TagLoadState {
  return store.loaded ? 'ready' : store.error ? 'failed' : 'loading'
}

type Option = { key: string; tag: Tag; create?: never } | { key: 'create'; create: string; tag?: never }

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

/**
 * The tag box for one transcript: its tags in the field with a remove button
 * each, a search that can create a tag, and every tag below with a ⋯ menu to
 * rename, recolour or delete it. Enter adds the highlighted tag (or removes
 * it if it is on) or creates the typed one; Backspace in an empty field takes
 * the last tag off. Escape closes the innermost layer first.
 */
export function TagPicker({ title, tags, selected, countOf, handlers, blocked = false, inputRef, loadState = 'ready', onRetry }: {
  /** The transcript's title, for the box's accessible name. */
  title: string
  tags: readonly Tag[]
  selected: readonly Tag[]
  countOf: (tagId: string) => number
  handlers: TagPickerHandlers
  /** True while an earlier tag change is waiting: choices are turned away. */
  blocked?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  /** Until tags have loaded the box takes no changes: it says so, or offers Retry. */
  loadState?: TagLoadState
  /** Reads the tags again; resolves false when that failed too. */
  onRetry?: () => Promise<boolean>
}) {
  const [retrying, setRetrying] = useState(false)
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<TagConfirm>(null)
  const ownInput = useRef<HTMLInputElement | null>(null)
  const input = inputRef ?? ownInput
  const id = useId()
  const listId = `${id}-list`

  const name = query.trim()
  const tooLong = nameLength(name) > LIMIT
  const on = new Set(selected.map((tag) => tag.id))
  const options: Option[] = [
    ...matchByName(tags, query).map((tag) => ({ key: tag.id, tag })),
    ...(name && !tooLong && !exactByName(tags, name) ? [{ key: 'create' as const, create: name }] : []),
  ]

  const choose = (option: Option) => {
    if (blocked) return
    if (option.tag) {
      if (on.has(option.tag.id)) handlers.onRemove(option.tag)
      else handlers.onAdd(option.tag)
    } else {
      handlers.onCreate(option.create)
    }
    setQuery('')
  }
  const keys = useListboxKeys(options, choose)

  if (loadState !== 'ready') {
    return (
      <div aria-label={`Tags for ${title}`} role="group" className="space-y-2 p-3 font-sans text-sm">
        {loadState === 'loading' || retrying ? (
          <p role="status" className="text-muted">Loading tags…</p>
        ) : (
          <>
            <p role="alert" className="text-ember-red">Couldn’t load your tags.</p>
            {onRetry && (
              <Button
                size="sm"
                variant="secondary"
                autoFocus
                onClick={() => {
                  setRetrying(true)
                  void onRetry().finally(() => setRetrying(false))
                }}
              >
                Retry
              </Button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div aria-label={`Tags for ${title}`} role="group">
      <div className="flex flex-wrap items-center gap-1.5 rounded-t-lg border-b border-border bg-subtle p-2.5">
        {selected.map((tag) => (
          <TagChip key={tag.id} tag={tag}>
            <button
              type="button"
              aria-label={`Remove ${tag.name}`}
              disabled={blocked}
              onClick={() => handlers.onRemove(tag)}
              className="flex h-5 w-5 items-center justify-center rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </TagChip>
        ))}
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Search or create a tag"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={keys.highlighted ? `${listId}-${keys.highlighted.key}` : undefined}
          aria-invalid={tooLong || undefined}
          placeholder="Search or create a tag"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            keys.reset()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !query && selected.length > 0 && !blocked) {
              event.preventDefault()
              handlers.onRemove(selected[selected.length - 1])
              return
            }
            keys.onKeyDown(event)
          }}
          className="h-6 min-w-[8.5rem] flex-1 bg-transparent px-0.5 font-sans text-[13px] text-foreground outline-none placeholder:text-foreground/40"
        />
      </div>
      {tooLong && (
        <p role="alert" className="px-3 pt-2 text-xs text-ember-red">Tag names must be {LIMIT} characters or fewer.</p>
      )}
      <p className="px-3 pt-2 pb-1 font-sans text-xs text-muted">
        {tags.length > 0 ? 'Select a tag or create one' : 'Type a name to create your first tag'}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label="Tags"
        aria-multiselectable
        className="max-h-64 overflow-y-auto px-1.5 pb-1.5"
      >
        {options.map((option) => {
          const highlighted = option === keys.highlighted
          if (option.create !== undefined) {
            return (
              <button
                key="create"
                id={`${listId}-create`}
                type="button"
                role="option"
                aria-selected={false}
                tabIndex={-1}
                disabled={blocked}
                onMouseEnter={() => keys.point(option)}
                onClick={() => choose(option)}
                className={cn('flex h-[34px] w-full items-center gap-2 rounded-md px-2 text-left font-sans text-[13px]',
                  highlighted && 'bg-subtle')}
              >
                <Plus className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                <span className="text-muted">Create</span>
                <TagChip tag={{ name: option.create, color: newTagColor(tags) }} />
              </button>
            )
          }
          const tag = option.tag
          return (
            <div
              key={tag.id}
              onMouseEnter={() => keys.point(option)}
              className={cn('flex items-center gap-0.5 rounded-md', (highlighted || menuFor === tag.id) && 'bg-subtle')}
            >
              <button
                id={`${listId}-${tag.id}`}
                type="button"
                role="option"
                aria-selected={on.has(tag.id)}
                tabIndex={-1}
                disabled={blocked}
                onClick={() => choose(option)}
                className="flex h-[34px] min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left"
              >
                <TagChip tag={tag} />
                {on.has(tag.id) && <Check className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
              </button>
              <TagOptionMenu
                tag={tag}
                tags={tags}
                count={countOf(tag.id)}
                open={menuFor === tag.id}
                onOpenChange={(open) => setMenuFor(open ? tag.id : null)}
                onRename={handlers.onRename}
                onRecolour={handlers.onRecolour}
                onAskDelete={() => {
                  setMenuFor(null)
                  setConfirm({ kind: 'delete', tag })
                }}
                onAskMerge={(into) => {
                  setMenuFor(null)
                  setConfirm({ kind: 'merge', from: tag, into })
                }}
              />
            </div>
          )
        })}
      </div>
      <TagConfirmDialog
        confirm={confirm}
        countOf={countOf}
        onClose={() => setConfirm(null)}
        onDelete={handlers.onDelete}
        onMerge={handlers.onMerge}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          input.current?.focus()
        }}
      />
    </div>
  )
}

/**
 * A tag's ⋯ menu inside the tag box: its name (saved on Enter or when the
 * field loses focus), how many transcripts carry it, Delete, and its colour.
 * A name another tag has offers to merge the two instead.
 */
function TagOptionMenu({ tag, tags, count, open, onOpenChange, onRename, onRecolour, onAskDelete, onAskMerge }: {
  tag: Tag
  tags: readonly Tag[]
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: (tag: Tag, name: string) => Promise<void>
  onRecolour: (tag: Tag, color: string) => Promise<void>
  onAskDelete: () => void
  onAskMerge: (into: Tag) => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Options for ${tag.name}`}
          className="mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-subtle-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="z-[110] w-64 p-3">
        <TagOptionFields
          tag={tag}
          tags={tags}
          count={count}
          onRename={onRename}
          onRecolour={onRecolour}
          onAskDelete={onAskDelete}
          onAskMerge={onAskMerge}
        />
      </PopoverContent>
    </Popover>
  )
}

function TagOptionFields({ tag, tags, count, onRename, onRecolour, onAskDelete, onAskMerge }: {
  tag: Tag
  tags: readonly Tag[]
  count: number
  onRename: (tag: Tag, name: string) => Promise<void>
  onRecolour: (tag: Tag, color: string) => Promise<void>
  onAskDelete: () => void
  onAskMerge: (into: Tag) => void
}) {
  const [draft, setDraft] = useState(tag.name)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  // Escape puts the old name back; the blur that follows must save nothing.
  const skipBlur = useRef(false)
  // The name last sent, so a blur right after Enter does not send it twice.
  const sent = useRef<string | null>(null)

  const name = draft.trim()
  const tooLong = nameLength(name) > LIMIT
  const clash = name ? tags.find((other) => other.id !== tag.id && sameName(other.name, name)) : undefined

  const commit = () => {
    if (!name || tooLong || name === tag.name || sent.current === name) return
    sent.current = name
    if (clash) {
      onAskMerge(clash)
      return
    }
    setError(null)
    onRename(tag, name).catch((caught) => {
      sent.current = null
      setError(messageOf(caught))
    })
  }

  return (
    <div className="space-y-2 font-sans">
      <label htmlFor={`${id}-name`} className="block text-xs text-muted">Name</label>
      <Input
        id={`${id}-name`}
        autoFocus
        value={draft}
        aria-invalid={tooLong || error ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          sent.current = null
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            skipBlur.current = true
            setDraft(tag.name)
          }
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false
            return
          }
          commit()
        }}
        className="h-8 py-1 text-[13px]"
      />
      {tooLong && <p role="alert" className="text-xs text-ember-red">Tag names must be {LIMIT} characters or fewer.</p>}
      {clash && !tooLong && (
        <p className="rounded-sm bg-subtle px-2 py-1.5 text-xs leading-snug">
          “{clash.name}” already exists. Saving offers to merge them.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-ember-red">{error}</p>}
      <p className="text-xs text-muted">On {countLabel(count, 'transcript', 'transcripts')}</p>
      <button
        type="button"
        onClick={onAskDelete}
        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[13px] text-ember-red hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete tag
      </button>
      <div className="-mx-3 border-t border-border" />
      <p className="text-xs text-muted">Colour</p>
      <ColourPicker current={tag.color} onChoose={(color) => onRecolour(tag, color)} describeError={messageOf} />
    </div>
  )
}
