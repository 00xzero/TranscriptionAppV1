/** Where a held navigation goes: a link's destination, or a navigation to run. */
export type LeaveTarget = (() => void) | { href: string; replace?: boolean; scroll?: boolean }

/**
 * What the open editor tells in-app navigation: whether it still has work
 * not saved, and how it lets the user go. Only one editor is open at a time.
 */
export type LeaveGuard = {
  pending(): boolean
  /** Lets the user go to `target` once its work is saved or they choose to leave anyway. */
  leave(target: LeaveTarget): void
}

let current: LeaveGuard | null = null

/** Installs the open editor's guard; the returned function removes it. */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  current = guard
  return () => { if (current === guard) current = null }
}

/**
 * Hands a navigation to the open editor while it has work not saved: it goes
 * to `target` itself when the user may leave. False when nothing holds it, so
 * the caller navigates now.
 */
export function holdLeave(target: LeaveTarget): boolean {
  if (!current?.pending()) return false
  current.leave(target)
  return true
}
