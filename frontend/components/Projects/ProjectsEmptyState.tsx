import { FolderOpen } from 'lucide-react'

type ProjectsEmptyStateVariant = 'no-projects' | 'empty-project' | 'empty-unfiled'

const copy: Record<ProjectsEmptyStateVariant, { title: string; description: string }> = {
  'no-projects': {
    title: 'No projects yet',
    description: 'Projects and unfiled transcripts will appear here.',
  },
  'empty-project': {
    title: 'This project is empty',
    description: 'Nested projects and transcripts will appear here.',
  },
  'empty-unfiled': {
    title: 'No unfiled transcripts',
    description: 'Transcripts without a project will appear here.',
  },
}

export function ProjectsEmptyState({ variant }: { variant: ProjectsEmptyStateVariant }) {
  const content = copy[variant]

  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-6 py-10 text-center">
      <FolderOpen className="h-8 w-8 text-muted" aria-hidden="true" />
      <h2 className="mt-3 font-serif text-xl text-foreground">{content.title}</h2>
      <p className="mt-1 text-sm text-muted">{content.description}</p>
    </div>
  )
}
