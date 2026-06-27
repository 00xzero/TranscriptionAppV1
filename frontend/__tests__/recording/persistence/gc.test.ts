import { InMemorySessionPersistence } from '@/lib/recording/persistence/inMemory'
import {
  gcExpiredSessions,
  SESSION_MAX_AGE_MS,
} from '@/lib/recording/persistence/gc'
import type { PersistedSession } from '@/lib/recording/persistence/types'

function makeSession(
  sessionId: string,
  createdAt: number
): PersistedSession {
  return {
    sessionId,
    userId: null,
    uploadIntentId: null,
    title: null,
    generatedTitle: null,
    keyTerms: [],
    codecMime: 'audio/webm',
    codecExtension: 'webm',
    deviceId: null,
    createdAt,
    startedAt: createdAt,
    lastResumeAt: createdAt,
    pausedAccumulatedMs: 0,
    bytesSoFar: 0,
    lastChunkSeq: null,
    lastChunkReceivedAt: null,
    phase: 'capturing',
    armed: true,
    failureReason: null,
  }
}

describe('gcExpiredSessions', () => {
  const NOW = 1_000_000_000_000

  test('deletes sessions older than the max age and their chunks', async () => {
    const store = new InMemorySessionPersistence()
    const old = makeSession('old', NOW - SESSION_MAX_AGE_MS - 1)
    const fresh = makeSession('fresh', NOW - 1_000)
    await store.putSession(old)
    await store.putSession(fresh)
    await store.putChunk('old', 0, new Blob([new Uint8Array(10)]))

    const deleted = await gcExpiredSessions(store, NOW)

    expect(deleted).toBe(1)
    expect(await store.getSession('old')).toBeNull()
    expect(await store.listChunkSeqs('old')).toEqual([])
    expect(await store.getSession('fresh')).not.toBeNull()
  })

  test('keeps a session exactly at the boundary minus one ms', async () => {
    const store = new InMemorySessionPersistence()
    await store.putSession(makeSession('edge', NOW - SESSION_MAX_AGE_MS + 1))

    const deleted = await gcExpiredSessions(store, NOW)

    expect(deleted).toBe(0)
    expect(await store.getSession('edge')).not.toBeNull()
  })

  test('deletes a session exactly at the boundary', async () => {
    const store = new InMemorySessionPersistence()
    await store.putSession(makeSession('edge', NOW - SESSION_MAX_AGE_MS))

    const deleted = await gcExpiredSessions(store, NOW)

    expect(deleted).toBe(1)
  })

  test('swallows a persistence failure and returns 0', async () => {
    const failing = {
      listSessions: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as InMemorySessionPersistence

    await expect(gcExpiredSessions(failing, NOW)).resolves.toBe(0)
  })
})
