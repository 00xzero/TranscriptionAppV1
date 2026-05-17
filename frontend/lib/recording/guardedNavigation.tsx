"use client"

import Link, { type LinkProps } from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'
import { useRecordingActions } from './RecordingSessionContext'
import { hasUnsavedRecording } from './session'

const CONFIRM_COPY =
  'Leaving this page will discard your recording. Continue?'

// Navigation to the recording page itself never risks data loss — clicking the
// header pill or any link that returns to `/recording/...` should never prompt.
function isSafeDestination(href: string | { pathname?: string | null } | null | undefined): boolean {
  if (!href) return false
  const path = typeof href === 'string' ? href : href.pathname ?? ''
  return path.startsWith('/recording/')
}

function confirmAndDiscard(actions: ReturnType<typeof useRecordingActions>): boolean {
  if (!hasUnsavedRecording()) return true
  const ok = window.confirm(CONFIRM_COPY)
  if (ok) {
    actions.discard()
  }
  return ok
}

export function useGuardedNavigate(): {
  push: (href: string) => void
  replace: (href: string) => void
  back: () => void
  confirmBeforeLeave: () => boolean
} {
  const router = useRouter()
  const actions = useRecordingActions()

  const push = useCallback(
    (href: string) => {
      if (!isSafeDestination(href) && !confirmAndDiscard(actions)) return
      router.push(href)
    },
    [router, actions]
  )

  const replace = useCallback(
    (href: string) => {
      if (!isSafeDestination(href) && !confirmAndDiscard(actions)) return
      router.replace(href)
    },
    [router, actions]
  )

  const back = useCallback(() => {
    if (!confirmAndDiscard(actions)) return
    router.back()
  }, [router, actions])

  const confirmBeforeLeave = useCallback(
    () => confirmAndDiscard(actions),
    [actions]
  )

  return { push, replace, back, confirmBeforeLeave }
}

/**
 * Installs a popstate listener that prompts when the user uses browser back
 * with an unsaved recording. On cancel, the URL is re-pushed to keep the
 * user on the current page.
 */
export function usePopStateGuard(): void {
  const router = useRouter()
  const actions = useRecordingActions()
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = () => {
      if (!hasUnsavedRecording()) return
      const ok = window.confirm(CONFIRM_COPY)
      if (ok) {
        actions.discard()
      } else {
        // `popstate` fires after the browser has already moved to the prior
        // entry. Restore both the URL and the App Router state when the user
        // cancels, otherwise the previous page can stay rendered under the
        // recording pathname.
        window.history.pushState(null, '', pathname)
        router.replace(pathname)
      }
    }

    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [actions, pathname, router])
}

type GuardedLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>

export const GuardedLink = forwardRef<HTMLAnchorElement, GuardedLinkProps>(
  function GuardedLink({ onClick, href, ...rest }, ref) {
    const actions = useRecordingActions()

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (onClick) onClick(event)
      if (event.defaultPrevented) return
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.currentTarget.target === '_blank'
      ) {
        return
      }
      if (isSafeDestination(href)) return
      if (!hasUnsavedRecording()) return
      const ok = window.confirm(CONFIRM_COPY)
      if (ok) {
        actions.discard()
      } else {
        event.preventDefault()
      }
    }

    return <Link ref={ref} href={href} {...rest} onClick={handleClick} />
  }
)
