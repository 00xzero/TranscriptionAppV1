"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

// Phase 3: in-app navigation is always allowed while recording. The dangerous
// boundary moved off "leaving /recording/new" and onto leaving the JS runtime
// (`beforeunload`, installed app-level in `RecordingSessionProvider`) and crossing
// the auth/context boundary (the sign-out guard in `Sidebar`). These thin wrappers
// remain only so existing call sites need no change — they no longer prompt or
// discard the recording on ordinary in-app navigation.

export const GuardedLink = Link

export function useGuardedNavigate(): {
  push: (href: string) => void
  replace: (href: string) => void
  back: () => void
} {
  const router = useRouter()

  const push = useCallback((href: string) => router.push(href), [router])
  const replace = useCallback((href: string) => router.replace(href), [router])
  const back = useCallback(() => router.back(), [router])

  return { push, replace, back }
}
