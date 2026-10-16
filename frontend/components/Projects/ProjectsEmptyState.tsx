import { EmptyState } from '@/components/EmptyState'

type ProjectsEmptyStateVariant = 'no-projects' | 'empty-project' | 'empty-unfiled'

export function ProjectsEmptyState({ variant, onAction }: { variant: ProjectsEmptyStateVariant; onAction?: () => void }) {
  if (variant === 'empty-unfiled') {
    // Nothing unfiled is good news: everything has a project.
    return (
      <EmptyState
        size="compact"
        figure="drawer"
        eyebrow="Unfiled"
        title="Everything’s filed"
        description="Transcripts that aren’t in a project yet will wait here."
        titleAs="h3"
      />
    )
  }
  if (variant === 'empty-project') {
    return (
      <EmptyState
        figure="drawer"
        eyebrow="This project"
        title="Room for transcripts"
        description="Add transcripts to this project, or give it a sub-project as it grows."
        action={onAction && { label: 'Add transcripts', onClick: onAction, creates: true }}
      />
    )
  }
  return (
    <EmptyState
      figure="drawer"
      eyebrow="Projects"
      title="Room for a project"
      description="Group related conversations into a project. Projects can hold sub-projects as they grow."
      action={onAction && { label: 'New project', onClick: onAction, creates: true }}
    />
  )
}
