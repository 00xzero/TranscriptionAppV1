'use client'

import { ancestorsOf } from '@/core/projects/tree'
import { useProjectsData } from '@/lib/projects/ProjectsProvider'
import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'
import { Breadcrumbs } from './Breadcrumbs'

/** Header title for `/projects` routes: breadcrumbs once the project resolves, else a Projects link. */
export function ProjectsHeaderTitle({ pathname }: { pathname: string }) {
  const { tree } = useProjectsData()
  const projectId = pathname.split('/')[2]
  const current = projectId ? tree.byId.get(projectId) : undefined

  if (current) {
    return <Breadcrumbs ancestors={ancestorsOf(tree, current.id) ?? []} current={current} />
  }

  return (
    <Link
      href="/projects"
      aria-current={pathname === '/projects' ? 'page' : undefined}
      className="truncate rounded-sm font-serif text-xl italic text-ink hover:text-trust-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60 dark:text-paper"
    >
      Projects
    </Link>
  )
}
