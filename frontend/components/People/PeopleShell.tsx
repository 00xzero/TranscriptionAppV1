'use client'

import { Suspense, type ReactNode } from 'react'
import { ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { LoadingStatus } from '@/components/ui/loading-status'
import { PeopleDirectoryProvider } from '@/lib/people/PeopleDirectoryContext'
import { PeopleListView } from './PeopleListView'

/**
 * Everything under /people: the list, and whatever the route adds over it (a
 * person's dialog). Held by the layout, so the list keeps its search, filters,
 * scroll and data while a person opens and closes (spec §4).
 */
export function PeopleShell({ children }: { children: ReactNode }) {
  // useSearchParams (the editor's ?from) needs Suspense boundaries.
  return (
    <PeopleDirectoryProvider>
      <Suspense fallback={<LoadingStatus message="Loading people…"><ProjectListSkeleton /></LoadingStatus>}>
        <PeopleListView />
      </Suspense>
      <Suspense fallback={null}>{children}</Suspense>
    </PeopleDirectoryProvider>
  )
}
