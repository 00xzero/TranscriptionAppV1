'use client'

import { useRef, useState } from 'react'
import { DestructiveMenuItem, RowActionsMenu } from '@/components/RowActionsMenu'
import { TranscriptTagPicker } from '@/components/Tags/TranscriptTagPicker'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAnchoredFocusReturn } from '@/lib/hooks/useAnchoredFocusReturn'

/**
 * A transcript row's ⋯ menu. Given the transcript's id it also offers
 * Tags…, which opens the tag box beside the button. The editor leaves it out:
 * its tag row sits right under the title.
 */
export function TranscriptActionsMenu({
  title,
  onMove,
  onDelete,
  transcriptId,
}: {
  title: string
  onMove: () => void
  onDelete: () => void
  transcriptId?: string
}) {
  const [tagsOpen, setTagsOpen] = useState(false)
  // Set while the menu closes for Tags…, so it doesn't hand focus back to its button.
  const openingTags = useRef(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const focusReturn = useAnchoredFocusReturn(anchor)

  const menu = (
    <RowActionsMenu
      label={title}
      onCloseAutoFocus={(event) => {
        if (!openingTags.current) return
        openingTags.current = false
        event.preventDefault()
        setTagsOpen(true)
      }}
    >
      {transcriptId && (
        <DropdownMenuItem onSelect={() => { openingTags.current = true }}>Tags…</DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={onMove}>Move to Project…</DropdownMenuItem>
      <DestructiveMenuItem onSelect={onDelete}>Delete</DestructiveMenuItem>
    </RowActionsMenu>
  )

  if (!transcriptId) return menu
  return (
    <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
      <PopoverAnchor asChild>
        <span ref={anchor} className="inline-flex">{menu}</span>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[340px] p-0"
        // The box has no trigger of its own: hand focus back to the row's ⋯ button.
        {...focusReturn}
      >
        <TranscriptTagPicker transcriptId={transcriptId} title={title} />
      </PopoverContent>
    </Popover>
  )
}
