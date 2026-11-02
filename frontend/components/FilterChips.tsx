'use client'

import type { ReactNode } from 'react'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/** A filter chip, on or off. */
const FILTER_CHIP = cn(
  'h-8 max-w-64 gap-1.5 rounded-full border border-border bg-control px-3 text-xs font-normal text-foreground/80',
  'hover:bg-control-hover hover:text-foreground',
  'data-[state=on]:border-trust-blue/50 data-[state=on]:bg-warm-highlight data-[state=on]:text-trust-blue',
  'dark:data-[state=on]:bg-night-border dark:data-[state=on]:text-paper'
)

export type FilterOption = {
  value: string
  label: string
  /** How many items the chip alone would list. */
  count: number
  /** A dot before the label, e.g. a tag's colour. */
  color?: string
}

/**
 * All, then one chip per option, each with the number of items it would list.
 * Any number can be on, and the list shows items in any of them; All turns
 * them all off. While exactly one is on, `menu` can put actions beside it
 * (rename, delete…).
 */
export function FilterChips({ label, total, options, selected, onChange, menu }: {
  /** The group's accessible name. */
  label: string
  /** All's count. */
  total: number
  options: readonly FilterOption[]
  selected: readonly string[]
  onChange: (selected: string[]) => void
  menu?: (value: string) => ReactNode
}) {
  const toggle = (value: string, on: boolean) =>
    onChange(on ? [...selected, value] : selected.filter((entry) => entry !== value))
  const only = selected.length === 1 ? selected[0] : null

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <Toggle pressed={selected.length === 0} onPressedChange={() => onChange([])} className={FILTER_CHIP}>
        All <span className="font-mono text-[11px] text-muted">{total}</span>
      </Toggle>
      {options.map((option) => (
        <span key={option.value} className="inline-flex items-center gap-0.5">
          <Toggle
            pressed={selected.includes(option.value)}
            onPressedChange={(on) => toggle(option.value, on)}
            className={FILTER_CHIP}
          >
            {option.color && (
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
            )}
            <span className="truncate">{option.label}</span>
            <span className="font-mono text-[11px] text-muted">{option.count}</span>
          </Toggle>
          {only === option.value && menu?.(option.value)}
        </span>
      ))}
    </div>
  )
}
