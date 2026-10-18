'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  arrivedEntry,
  backToListAction,
  closeAction,
  entryState,
  FRESH_VIEW,
  openedEntry,
  personEntry,
  readEntry,
  readScreen,
  readView,
  screenSearch,
  type PeopleDialogEntry,
  type PeopleDialogScreen,
  type PeopleDialogView,
} from '@/core/projects/people-dialog-history'
import { isPersonId } from '@/lib/people/routes'

/** Saved views live for the tab, keyed by history entry; the newest few are kept. */
const VIEWS_KEY = 'project-people-views'
const VIEWS_KEPT = 20
const SAVE_PAUSE_MS = 150
/** How long a step back may take before the dialog listens to ← and × again regardless. */
const TRAVERSAL_LIMIT_MS = 1000

type StoredViews = { order: string[]; views: Record<string, unknown> }

function readStored(): StoredViews {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(VIEWS_KEY) ?? 'null')
    if (typeof parsed === 'object' && parsed !== null) {
      const { order, views } = parsed as Record<string, unknown>
      if (Array.isArray(order) && typeof views === 'object' && views !== null) {
        return { order: order.filter((id): id is string => typeof id === 'string'), views: views as Record<string, unknown> }
      }
    }
  } catch { }
  return { order: [], views: {} }
}

function storedView(entryId: string): PeopleDialogView | null {
  return readView(readStored().views[entryId])
}

function storeView(entryId: string, view: PeopleDialogView) {
  const stored = readStored()
  const order = [...stored.order.filter((id) => id !== entryId), entryId].slice(-VIEWS_KEPT)
  const views: Record<string, unknown> = {}
  for (const id of order) views[id] = id === entryId ? view : stored.views[id]
  try { sessionStorage.setItem(VIEWS_KEY, JSON.stringify({ order, views })) } catch { }
}

function newEntryId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function addressFor(screen: PeopleDialogScreen): string {
  return `${window.location.pathname}${screenSearch(new URLSearchParams(window.location.search), screen)}`
}

export type PeopleDialogRoute = {
  screen: PeopleDialogScreen
  /** The view to start from as the dialog mounts: saved for this entry, or fresh. */
  initialView: () => PeopleDialogView
  /** True while the dialog is open because the header opened it, not because the address did. */
  openedHere: () => boolean
  open: () => void
  choosePerson: (personId: string) => void
  backToList: () => void
  close: () => void
  /** The address names a person who is not in the project: show the list instead. */
  dropPerson: () => void
  /** What the dialog looks like now, saved for its entry after a short pause. */
  updateView: (change: Partial<PeopleDialogView>) => void
  /** Save now, for a step the dialog takes itself, such as following a link. */
  flush: () => void
  /**
   * Hears the view to show whenever the dialog moves to another entry while
   * open (Back, Forward, choosing a person), and whether it arrives on a
   * person, whose scroll is theirs alone to change.
   */
  subscribeRestore: (listener: RestoreListener) => () => void
}

export type RestoreListener = (view: PeopleDialogView, toPerson: boolean) => void

/**
 * A project's people dialog, held in the address and the browser history so
 * Back and Forward step through it and coming back finds it as it was left.
 *
 * Its steps change the address with window.history, which Next keeps in sync
 * with useSearchParams, so nothing navigates or refetches. Each entry carries
 * only our own data: the router copies its internal fields in itself, and
 * handing them back would make it skip the sync.
 *
 * What the dialog looks like is saved per entry in sessionStorage, always
 * under the id of the entry it was seen on. That id is held here, not read
 * from history.state, because by the time Back is noticed the state already
 * belongs to the entry being returned to.
 */
export function usePeopleDialogRoute(): PeopleDialogRoute {
  const params = useSearchParams()
  const search = params.toString()
  const screen = useMemo(() => readScreen(new URLSearchParams(search), isPersonId), [search])

  const entryRef = useRef<PeopleDialogEntry | null>(null)
  const viewRef = useRef<PeopleDialogView>(FRESH_VIEW)
  const openedHereRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const listenersRef = useRef(new Set<RestoreListener>())
  // A step back (← or ×) runs a moment later, when the browser reports it.
  // Until then the dialog still shows where it was, so a second press (× then
  // Esc, a held arrow key) would go back again: past the list, or off the page.
  // Presses in that gap are ignored; the limit keeps them from being ignored
  // for good should the browser never report the step.
  const traversingRef = useRef<number | null>(null)

  const traverse = useCallback((delta: number) => {
    traversingRef.current = window.setTimeout(() => { traversingRef.current = null }, TRAVERSAL_LIMIT_MS)
    window.history.go(delta)
  }, [])

  const traversed = useCallback(() => {
    if (traversingRef.current === null) return
    window.clearTimeout(traversingRef.current)
    traversingRef.current = null
  }, [])

  const subscribeRestore = useCallback((listener: RestoreListener) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const showView = useCallback((view: PeopleDialogView, toPerson: boolean) => {
    viewRef.current = view
    for (const listener of listenersRef.current) listener(view, toPerson)
  }, [])

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (entryRef.current) storeView(entryRef.current.entry, viewRef.current)
  }, [])

  const updateView = useCallback((change: Partial<PeopleDialogView>) => {
    viewRef.current = { ...viewRef.current, ...change }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(flush, SAVE_PAUSE_MS)
  }, [flush])

  // Taking up the history entry the browser is now on, after Back or Forward:
  // save the one being left under its own id first, then show the one
  // arrived at as it was saved. An entry with nothing saved keeps what is on
  // screen, but a person reached that way starts at the top rather than at
  // another person's scroll.
  //
  // Two things notice the move and both call this; whichever comes second
  // finds nothing left to do. Which comes first is not ours to choose: React
  // renders updates made during popstate synchronously, so the router's own
  // listener (registered before ours) can re-render the page and run the
  // effect below before our listener has heard the event at all.
  const adoptEntry = useCallback(() => {
    traversed()
    const current = readEntry(window.history.state)
    if ((current?.entry ?? null) === (entryRef.current?.entry ?? null)) return
    flush()
    entryRef.current = current
    if (!current) return
    const toPerson = readScreen(new URLSearchParams(window.location.search), isPersonId).kind === 'person'
    showView(storedView(current.entry) ?? { ...viewRef.current, personScroll: 0 }, toPerson)
  }, [flush, showView, traversed])

  useEffect(() => {
    const onPageHide = () => flush()
    window.addEventListener('popstate', adoptEntry)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('popstate', adoptEntry)
      window.removeEventListener('pagehide', onPageHide)
      // Leaving the page (a transcript, the People page): keep where it was.
      flush()
      traversed()
    }
  }, [adoptEntry, flush, traversed])

  // Every change of address: take up the entry it is on. One reached by
  // address with nothing of ours on it is marked, so what happens here is kept
  // for the next time it comes back. Our own steps set the entry before they
  // change the address, so for them this finds nothing to do.
  useEffect(() => {
    if (screen.kind === 'closed') {
      adoptEntry()
      openedHereRef.current = false
      return
    }
    if (readEntry(window.history.state)) {
      adoptEntry()
      return
    }
    flush()
    const arrived = arrivedEntry(newEntryId())
    entryRef.current = arrived
    window.history.replaceState(entryState(arrived), '', window.location.href)
  }, [search, screen.kind, adoptEntry, flush])

  const initialView = useCallback((): PeopleDialogView => {
    if (openedHereRef.current) return (viewRef.current = FRESH_VIEW)
    const entry = readEntry(window.history.state)
    return (viewRef.current = (entry && storedView(entry.entry)) ?? FRESH_VIEW)
  }, [])

  const open = useCallback(() => {
    flush()
    const entry = openedEntry(newEntryId())
    entryRef.current = entry
    viewRef.current = FRESH_VIEW
    openedHereRef.current = true
    window.history.pushState(entryState(entry), '', addressFor({ kind: 'list' }))
  }, [flush])

  const choosePerson = useCallback((personId: string) => {
    flush()
    const entry = personEntry(entryRef.current ?? arrivedEntry(newEntryId()), newEntryId())
    // The list behind her comes with her: filter, section and scroll. She
    // starts at the top, on screen as in what is saved, even when her screen
    // is still drawn from a moment ago.
    showView({ ...viewRef.current, personScroll: 0 }, true)
    storeView(entry.entry, viewRef.current)
    entryRef.current = entry
    window.history.pushState(entryState(entry), '', addressFor({ kind: 'person', personId }))
  }, [flush, showView])

  const backToList = useCallback(() => {
    if (traversingRef.current !== null) return
    flush()
    if (backToListAction(entryRef.current) === 'history-back') {
      traverse(-1)
      return
    }
    const entry = entryRef.current ?? arrivedEntry(newEntryId())
    entryRef.current = entry
    window.history.replaceState(entryState(entry), '', addressFor({ kind: 'list' }))
  }, [flush, traverse])

  const close = useCallback(() => {
    if (traversingRef.current !== null) return
    flush()
    const action = closeAction(entryRef.current)
    if (action.kind === 'go') {
      traverse(action.delta)
      return
    }
    entryRef.current = null
    window.history.replaceState(null, '', addressFor({ kind: 'closed' }))
  }, [flush, traverse])

  const dropPerson = useCallback(() => {
    const entry = entryRef.current ?? arrivedEntry(newEntryId())
    entryRef.current = entry
    window.history.replaceState(entryState(entry), '', addressFor({ kind: 'list' }))
  }, [])

  const openedHere = useCallback(() => openedHereRef.current, [])

  return { screen, initialView, openedHere, open, choosePerson, backToList, close, dropPerson, updateView, flush, subscribeRestore }
}
