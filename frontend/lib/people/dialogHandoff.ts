/**
 * A dialog elsewhere in the app that opens a person on the People page hands
 * over to that person's dialog: the backdrop should stay dark across the route
 * change, not vanish with the old dialog and fade back in with the new one.
 * The opener marks the handoff as its link is followed; the person dialog
 * opens without its entrance animation if the mark is fresh.
 *
 * Module state, not React state: it has to outlive the page that set it. A
 * plain read, cleared after the dialog mounts, so StrictMode's second call of
 * a state initializer sees the same answer as the first.
 */

/** A route that takes longer than this to arrive just gets the usual entrance. */
const FRESH_MS = 5_000

let markedAt: number | null = null

export function markPersonDialogHandoff(): void {
  markedAt = Date.now()
}

export function isPersonDialogHandoff(): boolean {
  return markedAt !== null && Date.now() - markedAt < FRESH_MS
}

export function clearPersonDialogHandoff(): void {
  markedAt = null
}
