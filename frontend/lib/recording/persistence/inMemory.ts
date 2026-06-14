import type {
  PersistedSession,
  PersistedSessionPatch,
  SessionPersistence,
} from './types'

/**
 * Map-backed fake for fast unit tests. Mirrors the IndexedDB adapter's observable
 * behavior (seq-ordered reads, delete-cascade) without a real database.
 */
export class InMemorySessionPersistence implements SessionPersistence {
  private readonly sessions = new Map<string, PersistedSession>()
  private readonly chunks = new Map<string, Map<number, Blob>>()

  async putSession(record: PersistedSession): Promise<void> {
    this.sessions.set(record.sessionId, { ...record })
  }

  async patchSession(
    sessionId: string,
    patch: PersistedSessionPatch
  ): Promise<void> {
    const existing = this.sessions.get(sessionId)
    if (!existing) return
    this.sessions.set(sessionId, { ...existing, ...patch })
  }

  async getSession(sessionId: string): Promise<PersistedSession | null> {
    const found = this.sessions.get(sessionId)
    return found ? { ...found } : null
  }

  async listSessions(): Promise<PersistedSession[]> {
    return Array.from(this.sessions.values(), (s) => ({ ...s }))
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
    this.chunks.delete(sessionId)
  }

  async putChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
    let bucket = this.chunks.get(sessionId)
    if (!bucket) {
      bucket = new Map()
      this.chunks.set(sessionId, bucket)
    }
    bucket.set(seq, blob)
  }

  async listChunkSeqs(sessionId: string): Promise<number[]> {
    const bucket = this.chunks.get(sessionId)
    if (!bucket) return []
    return Array.from(bucket.keys()).sort((a, b) => a - b)
  }

  async readChunks(sessionId: string): Promise<Blob[]> {
    const bucket = this.chunks.get(sessionId)
    if (!bucket) return []
    return Array.from(bucket.keys())
      .sort((a, b) => a - b)
      .map((seq) => bucket.get(seq) as Blob)
  }
}
