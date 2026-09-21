'use client'

import { MoreHorizontal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Project } from '@/contracts/db'
import { collapseBreadcrumbs } from '@/core/projects/tree'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { useMediaQuery } from '@/lib/hooks/useMediaQuery'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface BreadcrumbsProps {
  ancestors: Project[]
  current: Project
}

type BreadcrumbLink = {
  id: string
  label: string
  href: string
}

type BreadcrumbAction = {
  id: string
  label: string
  onActivate: () => void
  ariaLabel: string
  tooltip?: string
}

export type BreadcrumbTrailItem = BreadcrumbLink | BreadcrumbAction

function isBreadcrumbLink(item: BreadcrumbTrailItem): item is BreadcrumbLink {
  return 'href' in item
}

function itemClassName(isCurrent: boolean): string {
  return `block max-w-24 truncate rounded-sm hover:text-trust-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60 sm:max-w-40 lg:max-w-56 ${
    isCurrent ? 'font-medium text-foreground' : 'text-muted'
  }`
}

function BreadcrumbActionButton({
  item,
  isCurrent,
}: {
  item: BreadcrumbAction
  isCurrent: boolean
}) {
  const button = (
    <button
      type="button"
      aria-label={item.ariaLabel}
      aria-current={isCurrent ? 'page' : undefined}
      onClick={item.onActivate}
      className={`${itemClassName(isCurrent)} border-0 bg-transparent p-0 text-left`}
    >
      {item.label}
    </button>
  )

  if (!item.tooltip) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{item.tooltip}</TooltipContent>
    </Tooltip>
  )
}

function BreadcrumbItemContent({
  item,
  isCurrent,
}: {
  item: BreadcrumbTrailItem
  isCurrent: boolean
}) {
  if (isBreadcrumbLink(item)) {
    return (
      <Link
        href={item.href}
        aria-current={isCurrent ? 'page' : undefined}
        className={itemClassName(isCurrent)}
      >
        {item.label}
      </Link>
    )
  }

  return <BreadcrumbActionButton item={item} isCurrent={isCurrent} />
}

export function BreadcrumbTrail({
  items,
  currentId,
  ariaLabel,
}: {
  items: BreadcrumbTrailItem[]
  currentId: string
  ariaLabel: string
}) {
  const isNarrow = useMediaQuery('(max-width: 767px)')
  const collapsed = collapseBreadcrumbs(items, isNarrow ? 3 : 5)
  const visible: Array<BreadcrumbTrailItem | 'collapsed'> = [
    ...collapsed.leading,
    ...(collapsed.collapsed.length > 0 ? (['collapsed'] as const) : []),
    ...collapsed.trailing,
  ]

  return (
    <nav aria-label={ariaLabel} className="min-w-0 overflow-hidden">
      <ol className="flex items-center gap-1.5 font-sans text-xs">
        {visible.map((item, index) => {
          const isCurrent = item !== 'collapsed' && item.id === currentId

          return (
            <li
              key={item === 'collapsed' ? 'collapsed' : item.id}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 && <span className="text-muted" aria-hidden="true">/</span>}
              {item === 'collapsed' ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Show hidden breadcrumbs"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60"
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {collapsed.collapsed.map((crumb) => (
                      <DropdownMenuItem key={crumb.id} asChild>
                        {isBreadcrumbLink(crumb) ? (
                          <Link href={crumb.href}>{crumb.label}</Link>
                        ) : (
                          <button
                            type="button"
                            aria-label={crumb.ariaLabel}
                            onClick={crumb.onActivate}
                          >
                            {crumb.label}
                          </button>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <BreadcrumbItemContent item={item} isCurrent={isCurrent} />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function Breadcrumbs({ ancestors, current }: BreadcrumbsProps) {
  const items: BreadcrumbTrailItem[] = [
    { id: 'projects-root', label: 'Projects', href: '/projects' },
    ...ancestors.map((project) => ({
      id: project.id,
      label: project.name,
      href: `/projects/${project.id}`,
    })),
    { id: current.id, label: current.name, href: `/projects/${current.id}` },
  ]

  return (
    <BreadcrumbTrail
      items={items}
      currentId={current.id}
      ariaLabel="Project breadcrumbs"
    />
  )
}
