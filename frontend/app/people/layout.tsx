import type { ReactNode } from 'react'
import { PeopleShell } from '@/components/People/PeopleShell'

/** The same page padding as Library and Transcripts. */
export default function PeopleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pb-10 pt-[80px] md:px-10">
      <PeopleShell>{children}</PeopleShell>
    </div>
  )
}
