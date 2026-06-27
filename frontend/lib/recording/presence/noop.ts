import type { RecordingPresence, RecordingPresenceChannel } from './types'

/** SSR / no-window no-op adapter. Presence is a client-only concern. */
export class NoopPresence implements RecordingPresenceChannel {
  publish(_presence: RecordingPresence): void {}
  clear(): void {}
  read(): RecordingPresence | null {
    return null
  }
  subscribe(_listener: () => void): () => void {
    return () => {}
  }
}
