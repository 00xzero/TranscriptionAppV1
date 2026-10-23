'use client'

import { Suspense, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { PeopleDirectoryProvider } from '@/lib/people/PeopleDirectoryContext'
import { PeopleListSkeleton, PeopleListView } from './PeopleListView'

/**
 * Everything under /people: the list, and whatever the route adds over it (a
 * person's dialog). Held by the layout, so the list keeps its search, filters,
 * scroll and data while a person opens and closes (spec §4).
 */
export function PeopleShell({ children }: { children: ReactNode }) {
  // Anything below /people is a dialog over the list. The list is put out of
  // reach while one is open: the dialog opens at once, while the list may still
  // be loading, and the modal's own hiding deliberately leaves live regions,
  // such as the list's loading status, exposed behind it.
  const overlaid = usePathname()?.replace(/\/+$/, '') !== '/people'
  // useSearchParams (the editor's ?from) needs Suspense boundaries.
  return (
    <PeopleDirectoryProvider>
      {/* inert takes it from the keyboard and the pointer; aria-hidden says
          the same to tools that do not read inert. */}
      <div inert={overlaid} aria-hidden={overlaid || undefined}>
        <Suspense fallback={<PeopleListSkeleton />}>
          <PeopleListView />
        </Suspense>
      </div>
      <Suspense fallback={null}>{children}</Suspense>
    </PeopleDirectoryProvider>
  )
}
