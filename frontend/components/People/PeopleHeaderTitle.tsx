'use client'

import { GuardedLink as Link } from '@/lib/recording/guardedNavigation'

/** Header title for `/people` routes. */
export function PeopleHeaderTitle({ pathname }: { pathname: string }) {
  return (
    <Link
      href="/people"
      aria-current={pathname === '/people' ? 'page' : undefined}
      className="truncate rounded-sm font-serif text-xl italic text-ink hover:text-trust-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-trust-blue/60 dark:text-paper"
    >
      People
    </Link>
  )
}
