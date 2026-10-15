import { useSyncExternalStore } from 'react'

type Key = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'getModifierState'>

/**
 * Undo or redo, from a key press: Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z and
 * Cmd/Ctrl+Y redo. Ignored during an input-method composition and with
 * AltGraph. Non-Latin layouts are read by key position.
 */
export function undoShortcut(e: Key): 'undo' | 'redo' | null {
  if (e.isComposing || e.altKey || e.getModifierState?.('AltGraph') || !(e.metaKey || e.ctrlKey)) return null
  const key = e.key.toLowerCase()
  const latin = /^[a-z]$/.test(key)
  const z = key === 'z' || (!latin && e.code === 'KeyZ')
  const y = key === 'y' || (!latin && e.code === 'KeyY')
  return z ? (e.shiftKey ? 'redo' : 'undo') : y && !e.shiftKey ? 'redo' : null
}

const isApplePlatform = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const noSubscription = () => () => {}

/** Whether to show Apple key names; false on the server, read after hydration on the client. */
export const useApplePlatform = () => useSyncExternalStore(noSubscription, isApplePlatform, () => false)
