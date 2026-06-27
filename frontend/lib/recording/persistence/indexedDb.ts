import {
  PersistedSessionSchema,
  type PersistedSession,
  type PersistedSessionPatch,
  type SessionPersistence,
} from './types'

const DB_NAME = 'olivetti-recording'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const CHUNKS_STORE = 'chunks'

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () =>
      reject(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'))
  })
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined)
  ) as T
}

/**
 * Compound out-of-line key range covering every `[sessionId, <seq>]` chunk.
 * An empty array sorts after any number in IndexedDB key ordering, so the upper
 * bound `[sessionId, []]` is a safe sentinel above all numeric seqs.
 */
function chunkRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId], [sessionId, []])
}

/**
 * Production adapter. `chunks` uses out-of-line keys so values stay raw `Blob`s
 * (no wrapper, no base64), matching the durability schema.
 */
export class IndexedDBSessionPersistence implements SessionPersistence {
  readonly durable = true
  private dbPromise: Promise<IDBDatabase> | null = null

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise

    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessions = db.createObjectStore(SESSIONS_STORE, {
            keyPath: 'sessionId',
          })
          sessions.createIndex('createdAt', 'createdAt')
        }
        if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
          // Out-of-line keys: value is the raw Blob, key is [sessionId, seq].
          db.createObjectStore(CHUNKS_STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () =>
        reject(new DOMException('IndexedDB open blocked', 'InvalidStateError'))
    })

    // Allow a later retry if the open fails (quota/private-mode/etc.).
    promise.catch(() => {
      this.dbPromise = null
    })

    this.dbPromise = promise
    return promise
  }

  async putSession(record: PersistedSession): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(SESSIONS_STORE, 'readwrite')
    tx.objectStore(SESSIONS_STORE).put(stripUndefined(record))
    await txDone(tx)
  }

  async patchSession(
    sessionId: string,
    patch: PersistedSessionPatch
  ): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(SESSIONS_STORE, 'readwrite')
    const store = tx.objectStore(SESSIONS_STORE)
    const existing = await promisifyRequest(store.get(sessionId))
    if (existing) {
      store.put({ ...existing, ...stripUndefined(patch) })
    }
    await txDone(tx)
  }

  async getSession(sessionId: string): Promise<PersistedSession | null> {
    const db = await this.openDb()
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const raw = await promisifyRequest(tx.objectStore(SESSIONS_STORE).get(sessionId))
    await txDone(tx)
    if (!raw) return null
    const parsed = PersistedSessionSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  async listSessions(): Promise<PersistedSession[]> {
    const db = await this.openDb()
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const raw = await promisifyRequest(tx.objectStore(SESSIONS_STORE).getAll())
    await txDone(tx)
    const out: PersistedSession[] = []
    for (const row of raw) {
      const parsed = PersistedSessionSchema.safeParse(row)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction([SESSIONS_STORE, CHUNKS_STORE], 'readwrite')
    tx.objectStore(SESSIONS_STORE).delete(sessionId)
    tx.objectStore(CHUNKS_STORE).delete(chunkRange(sessionId))
    await txDone(tx)
  }

  async putChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
    const db = await this.openDb()
    const tx = db.transaction(CHUNKS_STORE, 'readwrite')
    tx.objectStore(CHUNKS_STORE).put(blob, [sessionId, seq])
    await txDone(tx)
  }

  async listChunkSeqs(sessionId: string): Promise<number[]> {
    const db = await this.openDb()
    const tx = db.transaction(CHUNKS_STORE, 'readonly')
    const keys = await promisifyRequest(
      tx.objectStore(CHUNKS_STORE).getAllKeys(chunkRange(sessionId))
    )
    await txDone(tx)
    return (keys as IDBValidKey[]).map((key) => (key as [string, number])[1])
  }

  async chunkStats(
    sessionId: string
  ): Promise<{ count: number; totalBytes: number }> {
    const db = await this.openDb()
    const tx = db.transaction(CHUNKS_STORE, 'readonly')
    const store = tx.objectStore(CHUNKS_STORE)
    let count = 0
    let totalBytes = 0
    // Cursor pass over the key range: each step reads `value.size` (the Blob's
    // byte length) without retaining the Blob body, so no audio is held in
    // memory. `cursor.continue()` releases the prior value before advancing.
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(chunkRange(sessionId))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const blob = cursor.value as Blob
        count++
        totalBytes += blob.size
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    await txDone(tx)
    return { count, totalBytes }
  }

  async readChunks(sessionId: string): Promise<Blob[]> {
    const db = await this.openDb()
    const tx = db.transaction(CHUNKS_STORE, 'readonly')
    // getAll over a key range returns values in key order, i.e. ascending seq.
    const blobs = await promisifyRequest(
      tx.objectStore(CHUNKS_STORE).getAll(chunkRange(sessionId))
    )
    await txDone(tx)
    return blobs as Blob[]
  }
}
