'use client'

import { MoreHorizontal } from 'lucide-react'
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

type Breadcrumb = {
  id: string
  label: string
  href: string
}

export function Breadcrumbs({ ancestors, current }: BreadcrumbsProps) {
  const isNarrow = useMediaQuery('(max-width: 767px)')
  const crumbs: Breadcrumb[] = [
    { id: 'projects-root', label: 'Projects', href: '/projects' },
    ...ancestors.map((project) => ({
      id: project.id,
      label: project.name,
      href: `/projects/${project.id}`,
    })),
    { id: current.id, label: current.name, href: `/projects/${current.id}` },
  ]
  const collapsed = collapseBreadcrumbs(crumbs, isNarrow ? 3 : 5)
  const visible: Array<Breadcrumb | 'collapsed'> = [
    ...collapsed.leading,
    ...(collapsed.collapsed.length > 0 ? (['collapsed'] as const) : []),
    ...collapsed.trailing,
  ]

  return (
    <nav aria-label="Project breadcrumbs" className="min-w-0 overflow-hidden">
      <ol className="flex items-center gap-1.5 font-sans text-xs">
        {visible.map((item, index) => {
          const isCurrent = item !== 'collapsed' && item.id === current.id

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
                        <Link href={crumb.href}>{crumb.label}</Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link
                  href={item.href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`block max-w-24 truncate rounded-sm hover:text-trust-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60 sm:max-w-40 lg:max-w-56 ${
                    isCurrent ? 'font-medium text-foreground' : 'text-muted'
                  }`}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
