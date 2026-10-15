import { useSyncExternalStore } from 'react'

/** What the header's undo and redo buttons show and do, published by the open editor. */
export type UndoControls = {
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
  undo(): void
  redo(): void
  /** Changes with every change to the history: the undo list is only good for the version it opened on. */
  version: number
  /** The undo list's step names, newest first. */
  undoNames(): string[]
  /** Undoes the newest `count` steps. */
  undoMany(count: number): void
  /** A write is waiting for the connection; undo and redo are paused meanwhile. */
  reconnecting: boolean
}

// Module-level, as the toaster's: the header sits outside the editor's tree.
let current: UndoControls | null = null
const listeners = new Set<() => void>()

export function publishUndoControls(value: UndoControls | null): void {
  current = value
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The open editor's undo controls, or null when no editor is open. */
export const useUndoControls = () => useSyncExternalStore(subscribe, () => current, () => null)
