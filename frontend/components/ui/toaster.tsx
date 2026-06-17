"use client"

import * as React from 'react'
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast'

export interface ToastOptions {
  title: string
  description?: string
  /** Auto-dismiss delay; defaults to 5s. */
  durationMs?: number
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

  return (
    <ToastProvider swipeDirection="right" duration={5000}>
      {list.map((item) => (
        <Toast
          key={item.id}
          open={item.open}
          duration={item.durationMs ?? 5000}
          onOpenChange={(open) => setOpen(item.id, open)}
        >
          <ToastTitle>{item.title}</ToastTitle>
          {item.description ? (
            <ToastDescription>{item.description}</ToastDescription>
          ) : null}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
