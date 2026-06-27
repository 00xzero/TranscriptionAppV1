import type { RecordingPresence, RecordingPresenceChannel } from './types'

/**
 * Shared in-memory backing store so multiple `FakeRecordingPresence` instances
 * (simulated tabs) see the same snapshot and notify each other, mirroring how
 * localStorage + BroadcastChannel behave across real tabs.
 */
export class FakePresenceBus {
  snapshot: RecordingPresence | null = null
  readonly listeners = new Set<() => void>()

  notify(): void {
    this.listeners.forEach((l) => {
      try {
        l()
      } catch {
        // a listener throwing must not stop the others
      }
    })
  }
}

/** In-memory presence adapter for unit tests. */
export class FakeRecordingPresence implements RecordingPresenceChannel {
  constructor(private readonly bus: FakePresenceBus = new FakePresenceBus()) {}

  publish(presence: RecordingPresence): void {
    this.bus.snapshot = presence
    this.bus.notify()
  }

  clear(): void {
    this.bus.snapshot = null
    this.bus.notify()
  }

  read(): RecordingPresence | null {
    return this.bus.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.bus.listeners.add(listener)
    return () => {
      this.bus.listeners.delete(listener)
    }
  }
}
