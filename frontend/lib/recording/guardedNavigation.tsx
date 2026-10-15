"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, type ComponentProps } from 'react'
import { holdLeave } from '@/lib/editor/leaveGuard'

// Every in-app navigation goes through these wrappers. While recording, they
// let it through: the dangerous boundaries for a recording are leaving the JS
// runtime (`beforeunload`, installed app-level in `RecordingSessionProvider`)
// and crossing the auth/context boundary (the sign-out guard in `Sidebar`).
// While the editor has changes not saved yet, they hand the navigation to it
// (`holdLeave`), and it goes once they are saved or the user leaves anyway.

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export function GuardedLink({ onNavigate, ...props }: GuardedLinkProps) {
  const { href, replace, scroll } = props
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        onNavigate?.(event)
        if (holdLeave({ href, replace, scroll })) event.preventDefault()
      }}
    />
  )
}

export function useGuardedNavigate(): {
  push: (href: string) => void
  replace: (href: string) => void
  back: () => void
} {
  const router = useRouter()

  const push = useCallback((href: string) => {
    const go = () => router.push(href)
    if (!holdLeave(go)) go()
  }, [router])
  const replace = useCallback((href: string) => {
    const go = () => router.replace(href)
    if (!holdLeave(go)) go()
  }, [router])
  const back = useCallback(() => {
    const go = () => router.back()
    if (!holdLeave(go)) go()
  }, [router])

  return { push, replace, back }
}
