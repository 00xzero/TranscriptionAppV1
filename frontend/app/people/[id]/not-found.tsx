import { ErrorFallback } from '@/components/ErrorFallback'

export default function PersonNotFound() {
  return (
    <ErrorFallback
      eyebrow="404"
      title="Person not found"
      description="This person doesn't exist or isn't available to your account."
      primary={{ kind: 'link', label: 'View people', href: '/people' }}
      secondary={{ kind: 'link', label: 'Go home', href: '/' }}
    />
  )
}
