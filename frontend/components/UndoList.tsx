'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Word's undo list: the editor's steps, newest first. Pointing at a step marks
 * it and every newer one; choosing it undoes them all at once.
 *
 * The rows are the history as it was when the list opened, so the list is open
 * only while the history is still at that version: any change (Cmd+Z, a
 * replace, a save that lands) closes it, and a row always undoes what it names.
 * Undo becoming unavailable (reconnecting, or nothing left) closes it too, and
 * a closed list stays closed: it never reopens by itself over what the user
 * has moved on to.
 */
export function UndoList({ disabled, version, names, undoMany, className }: {
  disabled: boolean
  /** The history's version, which every change to it moves on. */
  version: number
  /** The steps' names, newest first, read as the list opens. */
  names(): string[]
  undoMany(count: number): void
  className?: string
}) {
  // The version the list opened on, while it is open.
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  // Closed during render, so a list the history moved past never paints.
  if (openedAt !== null && (disabled || openedAt !== version)) setOpenedAt(null)
  const open = openedAt !== null && openedAt === version && !disabled
  const [steps, setSteps] = useState<string[]>([])
  // How many of the newest steps are marked.
  const [marked, setMarked] = useState(0)
  const onOpenChange = (next: boolean) => {
    if (next) { setSteps(names()); setMarked(0) }
    setOpenedAt(next ? version : null)
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger disabled={disabled} aria-label="Undo list" className={className}>
            <ChevronDown className="h-3 w-3 opacity-60 group-hover:opacity-90 transition-opacity" aria-hidden />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Undo list</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52 p-1" onPointerLeave={() => setMarked(0)}>
        <div className="max-h-80 overflow-y-auto">
          {steps.map((name, i) => (
            <DropdownMenuItem
              key={i}
              onFocus={() => setMarked(i + 1)}
              // Not while the list fades out after the history moved on.
              onSelect={() => { if (open) undoMany(i + 1) }}
              className={cn('rounded-sm px-2.5 py-1 text-[13px] focus:bg-transparent',
                i < marked && 'bg-trust-blue/25 focus:bg-trust-blue/25')}
            >
              <span className="truncate">{name}</span>
            </DropdownMenuItem>
          ))}
        </div>
        <div aria-live="polite" className="mt-1 border-t border-border px-2.5 pt-1.5 pb-0.5 text-[11px] text-muted">
          {marked ? `Undo ${marked} ${marked === 1 ? 'Action' : 'Actions'}` : ' '}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
