import { SessionWriteQueue } from '@/lib/recording/persistence/writeQueue'
import { InMemorySessionPersistence } from '@/lib/recording/persistence/inMemory'
import type {
  PersistedSession,
  PersistedSessionPatch,
  SessionPersistence,
} from '@/lib/recording/persistence/types'

const SESSION_ID = 'session-1'

function makeRecord(): PersistedSession {
  return {
    sessionId: SESSION_ID,
    userId: null,
    uploadIntentId: null,
    title: 'Test',
    generatedTitle: null,
    keyTerms: [],
    codecMime: 'audio/webm',
    codecExtension: 'webm',
    deviceId: null,
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
  }
}

function blob(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)])
}

type Call =
  | { op: 'putSession' }
  | { op: 'putChunk'; seq: number }
  | { op: 'patchSession'; patch: PersistedSessionPatch }
  | { op: 'deleteSession' }

/** Records call order and supports per-method failure + a manual deferral gate. */
class LoggingPersistence implements SessionPersistence {
  readonly calls: Call[] = []
  failPutChunk = false
  failPatchSession = false
  private pendingGate: Promise<void> | null = null

  /** Make the next putChunk hang until the returned resolver is invoked. */
  deferNextChunk(): () => void {
    let release!: () => void
    this.pendingGate = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  }

  async putSession(_record: PersistedSession): Promise<void> {
    this.calls.push({ op: 'putSession' })
  }

  async patchSession(
    _sessionId: string,
    patch: PersistedSessionPatch
  ): Promise<void> {
    this.calls.push({ op: 'patchSession', patch })
    if (this.failPatchSession) throw new Error('patch failed')
  }

  async getSession(): Promise<PersistedSession | null> {
    return null
  }

  async listSessions(): Promise<PersistedSession[]> {
    return []
  }

  async deleteSession(): Promise<void> {
    this.calls.push({ op: 'deleteSession' })
  }

  async putChunk(_sessionId: string, seq: number): Promise<void> {
    if (this.pendingGate) {
      const gate = this.pendingGate
      this.pendingGate = null
      await gate
    }
    this.calls.push({ op: 'putChunk', seq })
    if (this.failPutChunk) throw new Error('chunk failed')
  }

  async listChunkSeqs(): Promise<number[]> {
    return []
  }

  async chunkStats(): Promise<{ count: number; totalBytes: number }> {
    return { count: 0, totalBytes: 0 }
  }

  async readChunks(): Promise<Blob[]> {
    return []
  }
}

describe('SessionWriteQueue ordering', () => {
  test('putSession is the first persistence op even if a chunk is enqueued first', async () => {
    const fake = new LoggingPersistence()
    const queue = new SessionWriteQueue(fake, SESSION_ID)

    // Chunk arrives before the session row is enqueued (theoretical sync chunk).
    queue.enqueueChunk(0, blob(10))
    queue.enqueueSession(makeRecord())
    queue.enqueueChunk(1, blob(10))

    await queue.whenSettled()

    expect(fake.calls.map((c) => c.op)).toEqual([
      'putSession',
      'putChunk',
      'putChunk',
    ])
    expect(fake.calls.filter((c) => c.op === 'putChunk')).toEqual([
      { op: 'putChunk', seq: 0 },
      { op: 'putChunk', seq: 1 },
    ])
  })

  test('chunks drain in FIFO seq order', async () => {
    const fake = new LoggingPersistence()
    const queue = new SessionWriteQueue(fake, SESSION_ID)
    queue.enqueueSession(makeRecord())
    for (let seq = 0; seq < 5; seq++) queue.enqueueChunk(seq, blob(4))

    await queue.whenSettled()

    expect(
      fake.calls.filter((c) => c.op === 'putChunk').map((c) => (c as { seq: number }).seq)
    ).toEqual([0, 1, 2, 3, 4])
  })

  test('consecutive metadata patches coalesce into one write', async () => {
    const fake = new LoggingPersistence()
    const queue = new SessionWriteQueue(fake, SESSION_ID)
    queue.enqueueSession(makeRecord())
    queue.enqueueMetadata({ bytesSoFar: 10 })
    queue.enqueueMetadata({ lastChunkSeq: 3 })
    queue.enqueueMetadata({ bytesSoFar: 20 })

    await queue.whenSettled()

    const patches = fake.calls.filter((c) => c.op === 'patchSession')
    expect(patches).toHaveLength(1)
    expect((patches[0] as { patch: PersistedSessionPatch }).patch).toEqual({
      bytesSoFar: 20,
      lastChunkSeq: 3,
    })
  })
})

describe('SessionWriteQueue downgrade', () => {
  test('a chunk write failure downgrades and writes a single armed:false marker', async () => {
    const fake = new LoggingPersistence()
    fake.failPutChunk = true
    const queue = new SessionWriteQueue(fake, SESSION_ID)

    queue.enqueueSession(makeRecord())
    queue.enqueueChunk(0, blob(10))
    await queue.whenSettled()

    expect(queue.isArmed()).toBe(false)
    const markers = fake.calls.filter(
      (c) => c.op === 'patchSession' && (c as { patch: PersistedSessionPatch }).patch.armed === false
    )
    expect(markers).toHaveLength(1)

    // Further writes are ignored after downgrade (recording continues regardless).
    queue.enqueueChunk(1, blob(10))
    await queue.whenSettled()
    expect(fake.calls.filter((c) => c.op === 'putChunk')).toHaveLength(1)
  })

  test('a failing armed:false marker is swallowed and does not recurse', async () => {
    const fake = new LoggingPersistence()
    fake.failPutChunk = true
    fake.failPatchSession = true
    const queue = new SessionWriteQueue(fake, SESSION_ID)

    queue.enqueueSession(makeRecord())
    queue.enqueueChunk(0, blob(10))
    await queue.whenSettled()
    // Give any (incorrect) recursive marker writes a chance to pile up.
    await new Promise((r) => setTimeout(r, 0))

    expect(queue.isArmed()).toBe(false)
    // Exactly one marker attempt — no recursion despite it failing.
    expect(fake.calls.filter((c) => c.op === 'patchSession')).toHaveLength(1)
  })
})

describe('SessionWriteQueue terminal teardown', () => {
  test('closeAndDelete after writes land removes the session and chunks', async () => {
    const store = new InMemorySessionPersistence()
    const queue = new SessionWriteQueue(store, SESSION_ID)
    queue.enqueueSession(makeRecord())
    queue.enqueueChunk(0, blob(10))
    queue.enqueueChunk(1, blob(10))
    await queue.whenSettled()

    expect(await store.listChunkSeqs(SESSION_ID)).toEqual([0, 1])

    await queue.closeAndDelete()

    expect(await store.getSession(SESSION_ID)).toBeNull()
    expect(await store.listChunkSeqs(SESSION_ID)).toEqual([])
  })

  test('terminal-cleanup race: closeAndDelete before drain leaves nothing, and post-close writes are no-ops', async () => {
    const store = new InMemorySessionPersistence()
    const queue = new SessionWriteQueue(store, SESSION_ID)

    // Enqueue then immediately tear down, before the drain microtask runs.
    queue.enqueueSession(makeRecord())
    queue.enqueueChunk(0, blob(10))
    queue.enqueueChunk(1, blob(10))
    const teardown = queue.closeAndDelete()

    // A late dataavailable after stop must not resurrect rows.
    queue.enqueueChunk(2, blob(10))

    await teardown

    expect(await store.getSession(SESSION_ID)).toBeNull()
    expect(await store.listChunkSeqs(SESSION_ID)).toEqual([])

    // Still nothing after everything settles.
    await new Promise((r) => setTimeout(r, 0))
    expect(await store.getSession(SESSION_ID)).toBeNull()
    expect(await store.listChunkSeqs(SESSION_ID)).toEqual([])
  })

  test('delete is ordered after an in-flight chunk write', async () => {
    const fake = new LoggingPersistence()
    const queue = new SessionWriteQueue(fake, SESSION_ID)
    queue.enqueueSession(makeRecord())
    const release = fake.deferNextChunk()
    queue.enqueueChunk(0, blob(10))

    // Let the drain run putSession and reach putChunk, which now hangs on the gate.
    await new Promise((r) => setTimeout(r, 0))

    // Begin teardown while the chunk write is still in flight.
    const teardown = queue.closeAndDelete()
    release()
    await teardown

    const ops = fake.calls.map((c) => c.op)
    expect(ops).toEqual(['putSession', 'putChunk', 'deleteSession'])
  })
})
