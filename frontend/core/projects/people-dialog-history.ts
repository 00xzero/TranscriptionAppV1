/**
 * Where a project's people dialog is, held in the page address so browser
 * Back and Forward step through it, and what each of its steps does to the
 * history. Pure: the hook in lib/projects applies these to window.history.
 *
 *   /projects/<id>            closed
 *   /projects/<id>?people     the people list
 *   /projects/<id>?people=<p> person <p>
 */

export const PEOPLE_PARAM = 'people'

/** The key our data sits under in a history entry, beside the router's own. */
export const HISTORY_KEY = 'projectPeople'

export type PeopleDialogScreen =
  | { kind: 'closed' }
  | { kind: 'list' }
  | { kind: 'person'; personId: string }

/**
 * Our data on one history entry of the dialog.
 *
 *   entry   names the entry, so what the dialog looked like there can be kept
 *   pushed  this entry was pushed from the list, so the list is one step back
 *   depth   how many dialog entries in a row lead back here from the page
 *   rooted  that run of entries began on the page with the dialog closed, so
 *           going back `depth` steps closes it
 */
export type PeopleDialogEntry = {
  entry: string
  pushed: boolean
  depth: number
  rooted: boolean
}

/** Everything the dialog restores when its entry comes back. */
export type PeopleDialogView = {
  query: string
  voicesOpen: boolean
  listScroll: number
  personScroll: number
}

export const FRESH_VIEW: PeopleDialogView = { query: '', voicesOpen: false, listScroll: 0, personScroll: 0 }

/** A person id that is not one opens the list rather than nothing. */
export function readScreen(params: URLSearchParams, isPersonId: (value: string) => boolean): PeopleDialogScreen {
  if (!params.has(PEOPLE_PARAM)) return { kind: 'closed' }
  const value = params.get(PEOPLE_PARAM) ?? ''
  return value && isPersonId(value) ? { kind: 'person', personId: value } : { kind: 'list' }
}

/**
 * The address search for a screen, keeping any other parameters. The list is
 * a bare `people`, not `people=`.
 */
export function screenSearch(current: URLSearchParams, screen: PeopleDialogScreen): string {
  const params = new URLSearchParams(current)
  params.delete(PEOPLE_PARAM)
  const rest = params.toString()
  const own = screen.kind === 'closed' ? ''
    : screen.kind === 'list' ? PEOPLE_PARAM
    : `${PEOPLE_PARAM}=${encodeURIComponent(screen.personId)}`
  const search = [rest, own].filter(Boolean).join('&')
  return search ? `?${search}` : ''
}

/** Our data on a history entry, or null for one we did not mark. */
export function readEntry(state: unknown): PeopleDialogEntry | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Record<string, unknown>)[HISTORY_KEY]
  if (typeof value !== 'object' || value === null) return null
  const { entry, pushed, depth, rooted } = value as Record<string, unknown>
  if (typeof entry !== 'string' || typeof pushed !== 'boolean' || typeof rooted !== 'boolean') return null
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null
  return { entry, pushed, depth, rooted }
}

/** The history state to pass for an entry: our data only, never the router's. */
export function entryState(entry: PeopleDialogEntry): { [HISTORY_KEY]: PeopleDialogEntry } {
  return { [HISTORY_KEY]: entry }
}

/** Opened from the page: one step from closed. */
export function openedEntry(id: string): PeopleDialogEntry {
  return { entry: id, pushed: false, depth: 1, rooted: true }
}

/** Reached by address (Back from elsewhere, a reload, a link): nothing of ours behind it. */
export function arrivedEntry(id: string): PeopleDialogEntry {
  return { entry: id, pushed: false, depth: 0, rooted: false }
}

/** A person chosen from the list: one more step on from it. */
export function personEntry(from: PeopleDialogEntry, id: string): PeopleDialogEntry {
  return { entry: id, pushed: true, depth: from.depth + 1, rooted: from.rooted }
}

/** ← on a person: back to the list's own entry when there is one, else turn this one into it. */
export function backToListAction(entry: PeopleDialogEntry | null): 'history-back' | 'replace' {
  return entry?.pushed ? 'history-back' : 'replace'
}

/**
 * × or Esc: back past every dialog entry when they began on the closed page,
 * so none are left behind; otherwise this entry becomes the closed page.
 */
export function closeAction(entry: PeopleDialogEntry | null): { kind: 'go'; delta: number } | { kind: 'replace' } {
  return entry && entry.rooted && entry.depth > 0 ? { kind: 'go', delta: -entry.depth } : { kind: 'replace' }
}

/** A saved view, read back defensively: storage is the user's, not ours. */
export function readView(value: unknown): PeopleDialogView | null {
  if (typeof value !== 'object' || value === null) return null
  const { query, voicesOpen, listScroll, personScroll } = value as Record<string, unknown>
  if (typeof query !== 'string' || typeof voicesOpen !== 'boolean') return null
  const scroll = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
  return { query, voicesOpen, listScroll: scroll(listScroll), personScroll: scroll(personScroll) }
}
