/**
 * @jest-environment node
 *
 * Runs in the Node environment (not jsdom) so `fake-indexeddb` has the
 * `structuredClone`, `Blob`, and `DOMException` globals it relies on.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import {
  IndexedDBSessionPersistence,
  InMemorySessionPersistence,
  type SessionPersistence,
} from '@/lib/recording/persistence'
import { gcExpiredSessions, SESSION_MAX_AGE_MS } from '@/lib/recording/persistence/gc'
import type { PersistedSession } from '@/lib/recording/persistence/types'

function makeSession(
  sessionId: string,
  overrides: Partial<PersistedSession> = {}
): PersistedSession {
  return {
    sessionId,
    userId: null,
    uploadIntentId: null,
    title: 'Test',
    generatedTitle: null,
    keyTerms: ['alpha'],
    codecMime: 'audio/webm;codecs=opus',
    codecExtension: 'webm',
    deviceId: 'mic-1',
    createdAt: 1_000,
    startedAt: 1_000,
    lastResumeAt: 1_000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 0,
    lastChunkSeq: null,
    lastChunkReceivedAt: null,
    phase: 'capturing',
    armed: true,
    failureReason: null,
    ...overrides,
  }
}

async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

describe('IndexedDBSessionPersistence', () => {
  beforeEach(() => {
    // Fresh database per test for isolation.
    indexedDB = new IDBFactory()
  })

  test('persists and reads back a session row', async () => {
    const store = new IndexedDBSessionPersistence()
    const record = makeSession('s1')
    await store.putSession(record)

    expect(await store.getSession('s1')).toEqual(record)
    expect(await store.listSessions()).toEqual([record])
    expect(await store.getSession('missing')).toBeNull()
  })

  test('patchSession merges into an existing row', async () => {
    const store = new IndexedDBSessionPersistence()
    await store.putSession(makeSession('s1'))

    await store.patchSession('s1', { bytesSoFar: 42, lastChunkSeq: 2, phase: 'uploading' })

    const updated = await store.getSession('s1')
    expect(updated?.bytesSoFar).toBe(42)
    expect(updated?.lastChunkSeq).toBe(2)
    expect(updated?.phase).toBe('uploading')
  })

  test.each([
    ['IndexedDB', () => new IndexedDBSessionPersistence()],
    ['InMemory', () => new InMemorySessionPersistence()],
  ])('%s patchSession ignores explicit undefined fields', async (_name, makeStore) => {
    const store = makeStore() as SessionPersistence
    await store.putSession(makeSession('s1', { title: 'Original title' }))

    await store.patchSession('s1', {
      title: undefined as never,
      bytesSoFar: 42,
    })

    const updated = await store.getSession('s1')
    expect(updated?.title).toBe('Original title')
    expect(updated?.bytesSoFar).toBe(42)
  })

  test('stores chunks as raw blobs and reads them back in seq order', async () => {
    const store = new IndexedDBSessionPersistence()
    await store.putSession(makeSession('s1'))
    // Insert out of order to prove seq ordering on read.
    await store.putChunk('s1', 2, new Blob([new Uint8Array([20, 21])]))
    await store.putChunk('s1', 0, new Blob([new Uint8Array([0, 1])]))
    await store.putChunk('s1', 1, new Blob([new Uint8Array([10, 11])]))

    expect(await store.listChunkSeqs('s1')).toEqual([0, 1, 2])

    const chunks = await store.readChunks('s1')
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toBeInstanceOf(Blob)
    expect(await blobBytes(chunks[0])).toEqual([0, 1])
    expect(await blobBytes(chunks[1])).toEqual([10, 11])
    expect(await blobBytes(chunks[2])).toEqual([20, 21])
  })

  test('chunks are scoped per session', async () => {
    const store = new IndexedDBSessionPersistence()
    await store.putSession(makeSession('s1'))
    await store.putSession(makeSession('s2'))
    await store.putChunk('s1', 0, new Blob([new Uint8Array([1])]))
    await store.putChunk('s2', 0, new Blob([new Uint8Array([2])]))
    await store.putChunk('s2', 1, new Blob([new Uint8Array([3])]))

    expect(await store.listChunkSeqs('s1')).toEqual([0])
    expect(await store.listChunkSeqs('s2')).toEqual([0, 1])
  })

  test('deleteSession cascades to the row and all chunks', async () => {
    const store = new IndexedDBSessionPersistence()
    await store.putSession(makeSession('s1'))
    await store.putSession(makeSession('s2'))
    await store.putChunk('s1', 0, new Blob([new Uint8Array([1])]))
    await store.putChunk('s1', 1, new Blob([new Uint8Array([2])]))
    await store.putChunk('s2', 0, new Blob([new Uint8Array([3])]))

    await store.deleteSession('s1')

    expect(await store.getSession('s1')).toBeNull()
    expect(await store.listChunkSeqs('s1')).toEqual([])
    // The other session is untouched.
    expect(await store.getSession('s2')).not.toBeNull()
    expect(await store.listChunkSeqs('s2')).toEqual([0])
  })

  test('GC sweep deletes only sessions older than the max age', async () => {
    const store = new IndexedDBSessionPersistence()
    const now = 1_000_000_000_000
    await store.putSession(makeSession('old', { createdAt: now - SESSION_MAX_AGE_MS - 1 }))
    await store.putSession(makeSession('fresh', { createdAt: now - 5_000 }))
    await store.putChunk('old', 0, new Blob([new Uint8Array([1])]))

    const deleted = await gcExpiredSessions(store, now)

    expect(deleted).toBe(1)
    expect(await store.getSession('old')).toBeNull()
    expect(await store.listChunkSeqs('old')).toEqual([])
    expect(await store.getSession('fresh')).not.toBeNull()
  })
})
