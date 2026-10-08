'use client'

import { Suspense } from 'react'
import { PeopleListView } from '@/components/People/PeopleListView'
import { ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { LoadingStatus } from '@/components/ui/loading-status'

export default function PeoplePage() {
  // useSearchParams (the editor's ?from) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingStatus message="Loading people…"><ProjectListSkeleton /></LoadingStatus>}>
      <PeopleListView />
    </Suspense>
  )
}
