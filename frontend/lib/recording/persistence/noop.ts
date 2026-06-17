import type {
  PersistedSession,
  PersistedSessionPatch,
  SessionPersistence,
} from './types'

/**
 * Silent no-op adapter. Selected when IndexedDB is unavailable (e.g. jsdom tests,
 * SSR). Keeps the recording session code path uniform without persisting anything.
 */
export class NoOpSessionPersistence implements SessionPersistence {
  async putSession(_record: PersistedSession): Promise<void> {}
  async patchSession(
    _sessionId: string,
    _patch: PersistedSessionPatch
  ): Promise<void> {}
  async getSession(_sessionId: string): Promise<PersistedSession | null> {
    return null
  }
  async listSessions(): Promise<PersistedSession[]> {
    return []
  }
  async deleteSession(_sessionId: string): Promise<void> {}
  async putChunk(_sessionId: string, _seq: number, _blob: Blob): Promise<void> {}
  async listChunkSeqs(_sessionId: string): Promise<number[]> {
    return []
  }
  async chunkStats(
    _sessionId: string
  ): Promise<{ count: number; totalBytes: number }> {
    return { count: 0, totalBytes: 0 }
  }
  async readChunks(_sessionId: string): Promise<Blob[]> {
    return []
  }
}
