import { ErrorFallback } from '@/components/ErrorFallback'

export default function ProjectNotFound() {
  return (
    <ErrorFallback
      eyebrow="404"
      title="Project not found"
      description="This project doesn't exist or isn't available to your account."
      primary={{ kind: 'link', label: 'View projects', href: '/projects' }}
      secondary={{ kind: 'link', label: 'Go home', href: '/' }}
    />
  )
}
