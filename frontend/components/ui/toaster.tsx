"use client"

import * as React from 'react'
import {
  Toast,
  ToastAction,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast'

export interface ToastOptions {
  title: string
  description?: string
  variant?: 'default' | 'error'
  /** Auto-dismiss delay; defaults to 5s. */
  durationMs?: number
  action?: { label: string; onClick: () => void }
  /** Keep recoverable editor text with this toast until explicit dismissal. */
  recovery?: { texts: readonly string[]; previews: readonly string[] }
}

interface ToastItem extends ToastOptions {
  id: number
  open: boolean
}

const REMOVE_DELAY_MS = 200

// Module-level store so any client code can fire a toast via `toast()` without a
// context/provider in scope, and without re-rendering the whole app subtree (only
// the mounted <Toaster /> subscribes).
let items: ToastItem[] = []
let nextId = 0
const listeners = new Set<(items: ToastItem[]) => void>()

function emit(): void {
  for (const listener of listeners) listener(items)
}

export function retainedToastTexts(): string[] {
  return items.flatMap((item) => item.open ? item.recovery?.texts ?? [] : [])
}

export function toast(options: ToastOptions): void {
  const id = nextId++
  items = [...items, { ...options, id, open: true }]
  emit()
}

function setOpen(id: number, open: boolean): void {
  items = items.map((item) => (item.id === id ? { ...item, open } : item))
  emit()
  if (!open) {
    // Drop it once the close animation has run.
    window.setTimeout(() => {
      items = items.filter((item) => item.id !== id)
      emit()
    }, REMOVE_DELAY_MS)
  }
}

/** Test hook: clear the toast store between tests. */
export function __resetToastsForTesting(): void {
  items = []
  nextId = 0
  emit()
}

/**
 * Host for app-wide toasts. Mount once near the app root. Toasts are dispatched
 * imperatively via the exported `toast()` function.
 */
export function Toaster(): React.JSX.Element {
  const [list, setList] = React.useState<ToastItem[]>(items)

  React.useEffect(() => {
    listeners.add(setList)
    setList(items)
    return () => {
      listeners.delete(setList)
    }
  }, [])

  // Reloading or closing the tab would lose text kept in a recovery toast, so
  // the browser asks first while one is open, as the editor does for drafts.
  const holdingText = list.some((item) => item.open && item.recovery)
  React.useEffect(() => {
    if (!holdingText) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Required by some browsers to show the warning.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [holdingText])

  return (
    <ToastProvider swipeDirection="right" duration={5000}>
      {list.map((item) => (
        <Toast
          key={item.id}
          open={item.open}
          duration={item.recovery ? Infinity : item.durationMs ?? 5000}
          data-recovery-toast={item.recovery ? item.id : undefined}
          onEscapeKeyDown={item.recovery ? (event) => {
            if (event.target instanceof Element &&
                event.target.closest('[data-recovery-toast]')?.getAttribute('data-recovery-toast') === String(item.id)) {
              event.preventDefault()
            }
          } : undefined}
          onSwipeStart={item.recovery ? (event) => event.preventDefault() : undefined}
          onSwipeMove={item.recovery ? (event) => event.preventDefault() : undefined}
          onSwipeEnd={item.recovery ? (event) => event.preventDefault() : undefined}
          className={
            item.variant === 'error'
              ? 'border-red-200/80 [background:color-mix(in_oklab,#fff1f2_78%,transparent)] text-ember-red dark:border-red-800/70 dark:[background:color-mix(in_oklab,rgb(127_29_29)_32%,transparent)] dark:text-red-100'
              : undefined
          }
          onOpenChange={(open) => { if (!item.recovery) setOpen(item.id, open) }}
        >
          <ToastTitle
            className={item.variant === 'error' ? 'font-sans text-sm font-bold not-italic text-ember-red dark:text-red-100' : undefined}
          >
            {item.title}
          </ToastTitle>
          {item.description ? (
            <ToastDescription
              className={item.variant === 'error' ? 'text-ember-red/80 dark:text-red-100/80' : undefined}
            >
              {item.description}
            </ToastDescription>
          ) : null}
          {item.recovery ? (
            <>
              <ul className="mt-2 space-y-1 text-sm [overflow-wrap:anywhere]">
                {item.recovery.previews.map((preview, index) => <li key={index}>{preview}</li>)}
                {item.recovery.texts.length > item.recovery.previews.length && (
                  <li>and {item.recovery.texts.length - item.recovery.previews.length} more</li>
                )}
              </ul>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" className="rounded-sm border border-current px-2 py-1 text-sm font-semibold"
                  onClick={item.action?.onClick}>{item.action?.label}</button>
                <button type="button" className="rounded-sm px-2 py-1 text-sm"
                  onClick={() => setOpen(item.id, false)}>Close</button>
              </div>
            </>
          ) : item.action ? (
            <ToastAction altText={item.action.label} asChild>
              <button type="button" className="mt-2 rounded-sm border border-current px-2 py-1 text-sm font-semibold"
                onClick={() => { item.action?.onClick(); setOpen(item.id, false) }}>
                {item.action.label}
              </button>
            </ToastAction>
          ) : null}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
