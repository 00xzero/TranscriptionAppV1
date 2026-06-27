/**
 * @jest-environment node
 *
 * Runs in the Node environment (not jsdom) so `fake-indexeddb` has the
 * `structuredClone`, `Blob`, and `DOMException` globals it relies on. The probe
 * suite is exercised against both the in-memory fake and the real IndexedDB
 * adapter so the metadata-only `chunkStats` path gets fake-indexeddb coverage.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import {
  InMemorySessionPersistence,
  IndexedDBSessionPersistence,
  type PersistedSession,
  type SessionPersistence,
} from '@/lib/recording/persistence'
import { FakeSessionLock, type SessionLock } from '@/lib/recording/lock'
import type { RecordingPresence } from '@/lib/recording/presence'
import { probeRecoverableSessions } from '@/lib/recording/recovery'

const USER = 'user-1'
const NOW = 10_000

function baseSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    sessionId: 's1',
    userId: USER,
    uploadIntentId: 'intent-1',
    title: 'A recording',
    generatedTitle: null,
    keyTerms: ['alpha'],
    codecMime: 'audio/webm',
    codecExtension: 'webm',
    deviceId: null,
    createdAt: 1000,
    startedAt: 1000,
    lastResumeAt: 1000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 8192,
    lastChunkSeq: 1,
    lastChunkReceivedAt: 1000,
    phase: 'capturing',
    armed: true,
    failureReason: null,
    ...overrides,
  }
}

function makePresence(overrides: Partial<RecordingPresence> = {}): RecordingPresence {
  return {
    sessionId: 's1',
    ownerClientId: 'client-1',
    userId: USER,
    state: 'recording',
    title: null,
    startedAt: 1000,
    lastResumeAt: 1000,
    pausedAccumulatedMs: 0,
    bytesSoFar: 8192,
    lastChunkSeq: 1,
    lastChunkReceivedAt: 1000,
    heartbeatAt: 1000,
    ...overrides,
  }
}

async function seed(
  persistence: SessionPersistence,
  session: PersistedSession,
  seqs: number[],
  chunkBytes = 4096
): Promise<void> {
  await persistence.putSession(session)
  for (const seq of seqs) {
    await persistence.putChunk(session.sessionId, seq, new Blob([new Uint8Array(chunkBytes)]))
  }
}

type Adapter = { name: string; make: () => SessionPersistence }

const adapters: Adapter[] = [
  { name: 'InMemory', make: () => new InMemorySessionPersistence() },
  { name: 'IndexedDB', make: () => new IndexedDBSessionPersistence() },
]

describe.each(adapters)('probeRecoverableSessions ($name)', ({ make }) => {
  let persistence: SessionPersistence
  let lock: FakeSessionLock

  beforeEach(() => {
    // Fresh IndexedDB per test for the real adapter; harmless for the fake.
    indexedDB = new IDBFactory()
    persistence = make()
    lock = new FakeSessionLock()
  })

  test('claims and returns a valid orphan, taking the lock', async () => {
    await seed(persistence, baseSession({ sessionId: 's1' }), [0, 1])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result?.info.sessionId).toBe('s1')
    expect(result?.info.uploadIntentId).toBe('intent-1')
    expect(result?.info.remainingCount).toBe(0)
    // The probe claimed the lock so another tab can't also recover it.
    expect(await lock.isHeld('s1')).toBe(true)
  })

  test('silently deletes a below-floor orphan and returns null', async () => {
    await seed(
      persistence,
      baseSession({ sessionId: 's1', bytesSoFar: 8192 }),
      [0, 1],
      100
    )

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result).toBeNull()
    expect(await persistence.getSession('s1')).toBeNull()
  })

  test('uses persisted chunk bytes when advisory metadata is stale', async () => {
    await seed(persistence, baseSession({ sessionId: 's1', bytesSoFar: 100 }), [0, 1])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result?.info.sessionId).toBe('s1')
    // Floor + reported bytes come from chunkStats (4096 * 2), not bytesSoFar.
    expect(result?.info.bytesSoFar).toBe(8192)
    expect(await persistence.getSession('s1')).not.toBeNull()
  })

  test('silently deletes an orphan whose chunk stream is missing seq 0', async () => {
    await seed(persistence, baseSession({ sessionId: 's1' }), [1, 2])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result).toBeNull()
    expect(await persistence.getSession('s1')).toBeNull()
  })

  test("never surfaces or deletes a different user's session", async () => {
    await seed(persistence, baseSession({ sessionId: 'other', userId: 'user-2' }), [0, 1])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result).toBeNull()
    // Foreign rows are left intact for GC, not deleted.
    expect(await persistence.getSession('other')).not.toBeNull()
  })

  test('skips a session a live tab still owns (isHeld)', async () => {
    await seed(persistence, baseSession({ sessionId: 's1' }), [0, 1])
    lock.ownedElsewhere.add('s1')

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result).toBeNull()
    // Not deleted — the owner is still writing it.
    expect(await persistence.getSession('s1')).not.toBeNull()
  })

  test('skips a candidate when ownership liveness cannot be determined', async () => {
    await seed(persistence, baseSession({ sessionId: 's1' }), [0, 1])
    const acquire = jest.fn(async () => true)
    const failingLock: SessionLock = {
      isHeld: async () => {
        throw new Error('query failed')
      },
      acquire,
      release: async () => {},
    }

    const result = await probeRecoverableSessions(persistence, failingLock, USER, NOW)

    expect(result).toBeNull()
    expect(acquire).not.toHaveBeenCalled()
    expect(await persistence.getSession('s1')).not.toBeNull()
  })

  test('skips a candidate it cannot claim (claim race lost)', async () => {
    await seed(persistence, baseSession({ sessionId: 's1' }), [0, 1])
    // isHeld false (not yet owned) but acquire fails — another probing tab won.
    const raceLock: SessionLock = {
      isHeld: async () => false,
      acquire: async () => false,
      release: async () => {},
    }

    const result = await probeRecoverableSessions(persistence, raceLock, USER, NOW)

    expect(result).toBeNull()
    // Left intact: the tab that won the claim owns recovery.
    expect(await persistence.getSession('s1')).not.toBeNull()
  })

  test('processes newest-first and reports remaining valid orphans', async () => {
    await seed(persistence, baseSession({ sessionId: 'older', createdAt: 1000 }), [0, 1])
    await seed(persistence, baseSession({ sessionId: 'newer', createdAt: 2000 }), [0, 1])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result?.info.sessionId).toBe('newer')
    expect(result?.info.remainingCount).toBe(1)
  })

  test('excludes the live in-tab session id', async () => {
    await seed(persistence, baseSession({ sessionId: 'live' }), [0, 1])

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW, 'live')

    expect(result).toBeNull()
  })

  test('sweeps an expired orphan before probing (single list pass)', async () => {
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000
    await seed(
      persistence,
      baseSession({ sessionId: 'stale', createdAt: NOW - EIGHT_DAYS }),
      [0, 1]
    )

    const result = await probeRecoverableSessions(persistence, lock, USER, NOW)

    expect(result).toBeNull()
    // GC sweep deleted the row and its chunks.
    expect(await persistence.getSession('stale')).toBeNull()
    expect(await persistence.listChunkSeqs('stale')).toEqual([])
  })
})

describe('probeRecoverableSessions truncation assessment', () => {
  let persistence: SessionPersistence
  let lock: FakeSessionLock

  beforeEach(() => {
    indexedDB = new IDBFactory()
    persistence = new InMemorySessionPersistence()
    lock = new FakeSessionLock()
  })

  async function probeWith(
    session: Partial<PersistedSession>,
    presence: RecordingPresence | null,
    readPresence?: () => RecordingPresence | null
  ) {
    await seed(persistence, baseSession({ sessionId: 's1', ...session }), [0, 1])
    return probeRecoverableSessions(
      persistence,
      lock,
      USER,
      NOW,
      null,
      readPresence ?? (() => presence)
    )
  }

  test('flags truncation when the recorder received >30s more than was persisted', async () => {
    const result = await probeWith(
      { lastChunkReceivedAt: 1000 },
      makePresence({ sessionId: 's1', lastChunkReceivedAt: 1000 + 40_000 })
    )
    expect(result?.info.mayBeTruncated).toBe(true)
  })

  test('does not flag a small captured-but-unsaved gap', async () => {
    const result = await probeWith(
      { lastChunkReceivedAt: 1000 },
      makePresence({ sessionId: 's1', lastChunkReceivedAt: 1000 + 5_000 })
    )
    expect(result?.info.mayBeTruncated).toBe(false)
  })

  test('ignores a large heartbeat gap when the chunk gap is small (pause-proof)', async () => {
    const result = await probeWith(
      { lastChunkReceivedAt: 1000 },
      makePresence({
        sessionId: 's1',
        lastChunkReceivedAt: 1000 + 1_000,
        heartbeatAt: 1000 + 60_000,
      })
    )
    expect(result?.info.mayBeTruncated).toBe(false)
  })

  test('never flags an interrupted upload (capture already complete)', async () => {
    const result = await probeWith(
      { phase: 'uploading', lastChunkReceivedAt: 1000 },
      makePresence({ sessionId: 's1', lastChunkReceivedAt: 1000 + 40_000 })
    )
    expect(result?.info.mayBeTruncated).toBe(false)
  })

  test('falls back to the armed flag when the snapshot is for another session', async () => {
    const result = await probeWith(
      { lastChunkReceivedAt: 1000, armed: false },
      makePresence({ sessionId: 'other', lastChunkReceivedAt: 1000 + 40_000 })
    )
    // Snapshot mismatch -> measurement skipped -> armed:false fallback warns.
    expect(result?.info.mayBeTruncated).toBe(true)
  })

  test('treats exactly the threshold as not truncated (strict >)', async () => {
    const result = await probeWith(
      { lastChunkReceivedAt: 1000 },
      makePresence({ sessionId: 's1', lastChunkReceivedAt: 1000 + 30_000 })
    )
    expect(result?.info.mayBeTruncated).toBe(false)
  })

  test('with no snapshot, flags a downgraded (unarmed) session', async () => {
    const result = await probeWith({ armed: false }, null)
    expect(result?.info.mayBeTruncated).toBe(true)
  })

  test('with no snapshot, does not flag an armed session', async () => {
    const result = await probeWith({ armed: true }, null)
    expect(result?.info.mayBeTruncated).toBe(false)
  })

  test('a throwing presence reader falls back to the armed flag', async () => {
    const result = await probeWith({ armed: false }, null, () => {
      throw new Error('localStorage blew up')
    })
    expect(result?.info.mayBeTruncated).toBe(true)
  })
})

describe('chunkStats summarizes without materializing blob bodies', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory()
  })

  test.each(adapters)('$name returns count + totalBytes', async ({ make }) => {
    const persistence = make()
    await persistence.putSession(baseSession({ sessionId: 's1' }))
    await persistence.putChunk('s1', 0, new Blob([new Uint8Array(1024)]))
    await persistence.putChunk('s1', 1, new Blob([new Uint8Array(2048)]))
    await persistence.putChunk('s1', 2, new Blob([new Uint8Array(512)]))

    expect(await persistence.chunkStats('s1')).toEqual({
      count: 3,
      totalBytes: 1024 + 2048 + 512,
    })
    // Empty/unknown session reports zeros.
    expect(await persistence.chunkStats('missing')).toEqual({ count: 0, totalBytes: 0 })
  })
})
