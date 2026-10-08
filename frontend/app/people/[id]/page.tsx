'use client'

import { Suspense } from 'react'
import { notFound, useParams } from 'next/navigation'
import { PersonView } from '@/components/People/PersonView'
import { ProjectListSkeleton } from '@/components/Projects/ProjectList'
import { LoadingStatus } from '@/components/ui/loading-status'
import { isPersonId } from '@/lib/people/routes'

export default function PersonPage() {
  const { id } = useParams<{ id: string }>()
  if (!isPersonId(id)) notFound()

  // useSearchParams (the editor's ?from) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingStatus message="Loading person…"><ProjectListSkeleton /></LoadingStatus>}>
      <PersonView key={id} personId={id} />
    </Suspense>
  )
}
