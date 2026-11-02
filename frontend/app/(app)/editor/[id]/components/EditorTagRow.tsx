'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TagChip } from '@/components/Tags/TagChip'
import { TagPicker, type TagLoadState, type TagPickerHandlers } from '@/components/Tags/TagPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Tag } from '@/contracts/db'

/**
 * The transcript's tags under the title, as chips. Clicking them (or the +)
 * opens the tag box.
 */
export function EditorTagRow({ title, tags, allTags, countOf, handlers, blocked, loadState, onRetry }: {
  title: string
  tags: readonly Tag[]
  allTags: readonly Tag[]
  countOf: (tagId: string) => number
  handlers: TagPickerHandlers
  blocked: boolean
  loadState: TagLoadState
  onRetry: () => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const label = tags.length > 0 ? `Tags: ${tags.map((tag) => tag.name).join(', ')}. Edit tags` : 'Add tags'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="-ml-1.5 mt-3 flex min-h-8 max-w-full flex-wrap items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-subtle"
        >
          {tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
          <span className="inline-flex h-6 items-center gap-1 px-1 font-sans text-[13px] text-muted">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {tags.length === 0 && 'Add tags'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-0">
        <TagPicker
          title={title}
          tags={allTags}
          selected={tags}
          countOf={countOf}
          handlers={handlers}
          blocked={blocked}
          loadState={loadState}
          onRetry={onRetry}
        />
      </PopoverContent>
    </Popover>
  )
}
