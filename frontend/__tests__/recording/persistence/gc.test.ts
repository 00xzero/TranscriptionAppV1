import { FakeSessionLock } from '@/lib/recording/lock'
import { InMemorySessionPersistence } from '@/lib/recording/persistence/inMemory'
import {
  sweepExpiredSessions,
  SESSION_MAX_AGE_MS,
} from '@/lib/recording/persistence/gc'
import type { PersistedSession } from '@/lib/recording/persistence/types'
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '@/contracts/transcription-options'

function makeSession(
  sessionId: string,
  createdAt: number
): PersistedSession {
  return {
    sessionId,
    userId: null,
    uploadIntentId: null,
    projectId: null,
    title: null,
    generatedTitle: null,
    keyTerms: [],
    transcriptionOptions: DEFAULT_TRANSCRIPTION_OPTIONS,
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

describe('sweepExpiredSessions', () => {
  const NOW = 1_000_000_000_000

  test('deletes sessions older than the max age and their chunks', async () => {
    const store = new InMemorySessionPersistence()
    const old = makeSession('old', NOW - SESSION_MAX_AGE_MS - 1)
    const fresh = makeSession('fresh', NOW - 1_000)
    await store.putSession(old)
    await store.putSession(fresh)
    await store.putChunk('old', 0, new Blob([new Uint8Array(10)]))

    const { deleted } = await sweepExpiredSessions(store, new FakeSessionLock(), await store.listSessions(), NOW)

    expect(deleted).toBe(1)
    expect(await store.getSession('old')).toBeNull()
    expect(await store.listChunkSeqs('old')).toEqual([])
    expect(await store.getSession('fresh')).not.toBeNull()
  })

  test('keeps a session exactly at the boundary minus one ms', async () => {
    const store = new InMemorySessionPersistence()
    await store.putSession(makeSession('edge', NOW - SESSION_MAX_AGE_MS + 1))

    const { deleted } = await sweepExpiredSessions(store, new FakeSessionLock(), await store.listSessions(), NOW)

    expect(deleted).toBe(0)
    expect(await store.getSession('edge')).not.toBeNull()
  })

  test('deletes a session exactly at the boundary', async () => {
    const store = new InMemorySessionPersistence()
    await store.putSession(makeSession('edge', NOW - SESSION_MAX_AGE_MS))

    const { deleted } = await sweepExpiredSessions(store, new FakeSessionLock(), await store.listSessions(), NOW)

    expect(deleted).toBe(1)
  })

  test('leaves an expired row intact while a different claim is held', async () => {
    const store = new InMemorySessionPersistence()
    const old = makeSession('old', NOW - SESSION_MAX_AGE_MS)
    await store.putSession(old)
    const lock = new FakeSessionLock()
    const claim = await lock.acquire('active')
    const result = await sweepExpiredSessions(store, lock, [old], NOW)
    expect(result.deleted).toBe(0)
    expect(await store.getSession('old')).not.toBeNull()
    expect(await lock.isHeld('active')).toBe(true)
    await claim?.release()
  })
})
