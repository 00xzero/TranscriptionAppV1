import { ErrorFallback } from '@/components/ErrorFallback'

export default function NotFound() {
  return (
    <ErrorFallback
      eyebrow="404"
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      primary={{ kind: 'link', label: 'Go home', href: '/' }}
      secondary={{ kind: 'link', label: 'View projects', href: '/projects' }}
    />
  )
}
