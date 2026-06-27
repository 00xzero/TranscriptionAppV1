import { parsePresence } from './validate'
import {
  PRESENCE_CHANNEL_NAME,
  PRESENCE_STORAGE_KEY,
  type RecordingPresence,
  type RecordingPresenceChannel,
} from './types'

/**
 * Production presence adapter.
 *
 * `localStorage` holds the latest snapshot so a tab that opens (or wakes) after a
 * live message can still read current presence. `BroadcastChannel` carries live
 * pushes so already-open tabs react immediately. `subscribe` listens to both the
 * channel and the `storage` event (the latter covers tabs that aren't the active
 * one and any missed channel message).
 */
export class BroadcastChannelPresence implements RecordingPresenceChannel {
  private channel: BroadcastChannel | null = null
  private readonly listeners = new Set<() => void>()

  private getChannel(): BroadcastChannel | null {
    if (this.channel) return this.channel
    try {
      this.channel = new BroadcastChannel(PRESENCE_CHANNEL_NAME)
    } catch {
      this.channel = null
    }
    return this.channel
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener()
      } catch {
        // A listener failure must not stop other subscribers.
      }
    })
  }

  publish(presence: RecordingPresence): void {
    try {
      window.localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(presence))
    } catch {
      // localStorage may be unavailable (private mode / quota); presence is
      // best-effort and must never break recording.
    }
    try {
      this.getChannel()?.postMessage({ type: 'presence' })
    } catch {
      // Channel post is best-effort.
    }
    this.notify()
  }

  clear(): void {
    try {
      window.localStorage.removeItem(PRESENCE_STORAGE_KEY)
    } catch {
      // ignore
    }
    try {
      this.getChannel()?.postMessage({ type: 'cleared' })
    } catch {
      // ignore
    }
    this.notify()
  }

  read(): RecordingPresence | null {
    try {
      return parsePresence(window.localStorage.getItem(PRESENCE_STORAGE_KEY))
    } catch {
      return null
    }
  }

  subscribe(listener: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PRESENCE_STORAGE_KEY) listener()
    }
    const onMessage = () => listener()

    const channel = this.getChannel()
    this.listeners.add(listener)
    channel?.addEventListener('message', onMessage)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage)
    }

    return () => {
      this.listeners.delete(listener)
      channel?.removeEventListener('message', onMessage)
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage)
      }
    }
  }
}
