import type { ReactNode } from 'react'

export default function PeopleLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 pb-10 pt-[80px] md:px-10">{children}</div>
}
