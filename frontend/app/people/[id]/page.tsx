'use client'

import { notFound, useParams } from 'next/navigation'
import { PersonDialog } from '@/components/People/PersonDialog'
import { isPersonId } from '@/lib/people/routes'

/** A person, opened as a dialog over the list the layout keeps (spec §4). */
export default function PersonPage() {
  const { id } = useParams<{ id: string }>()
  if (!isPersonId(id)) notFound()
  return <PersonDialog key={id} personId={id} />
}
