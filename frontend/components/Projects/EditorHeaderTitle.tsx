'use client'

import { ancestorsOf } from '@/core/projects/tree'
import { useProjectsData, useTranscriptsData } from '@/lib/projects/ProjectsProvider'
import { transcriptIdFromEditorPathname } from '@/lib/projects/routes'
import {
  BreadcrumbTrail,
  type BreadcrumbTrailItem,
} from './Breadcrumbs'

function transcriptCrumb(
  id: string,
  label: string,
  onActivate: () => void
): BreadcrumbTrailItem {
  return {
    id,
    label,
    onActivate,
    ariaLabel: `${label}, scroll to top`,
    tooltip: 'Scroll to top',
  }
}

export function EditorHeaderTitle({ pathname }: { pathname: string }) {
  const { tree } = useProjectsData()
  const { transcripts } = useTranscriptsData()
  const transcriptId = transcriptIdFromEditorPathname(pathname)
  const transcript = transcriptId
    ? transcripts.find((item) => item.id === transcriptId)
    : undefined
  const currentId = `transcript-${transcriptId ?? 'current'}`
  const title = transcript?.title || 'Transcript'
  const handleEditorTopReset = () => {
    window.dispatchEvent(new CustomEvent('editor-scroll-to-top'))
  }
  const items: BreadcrumbTrailItem[] = [
    { id: 'projects-root', label: 'Projects', href: '/projects' },
  ]

  if (transcript?.project_id === null) {
    items.push({ id: 'unfiled', label: 'Unfiled', href: '/projects#unfiled' })
  } else if (transcript?.project_id) {
    const project = tree.byId.get(transcript.project_id)
    if (project) {
      items.push(
        ...(ancestorsOf(tree, project.id) ?? []).map((ancestor) => ({
          id: ancestor.id,
          label: ancestor.name,
          href: `/projects/${ancestor.id}`,
        })),
        { id: project.id, label: project.name, href: `/projects/${project.id}` }
      )
    }
  }

  items.push(transcriptCrumb(currentId, title, handleEditorTopReset))

  return (
    <BreadcrumbTrail
      items={items}
      currentId={currentId}
      ariaLabel="Editor breadcrumbs"
    />
  )
}
