import type { ReactNode } from 'react'
import { ProjectArchivePanel } from '@/components/Projects/ProjectArchivePanel'

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-8 px-6 pb-10 pt-[80px] md:px-10">
      <ProjectArchivePanel />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
