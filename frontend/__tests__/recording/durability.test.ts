jest.mock('@/lib/capture/upload', () => ({ runCaptureUpload: jest.fn() }))

import {
  __resetForTesting,
  attachAndStart,
  discard,
  getSnapshot,
  recordChunk,
} from '@/lib/recording/session'
import { __setPersistenceForTesting } from '@/lib/recording/persistence'
import {
  __setSessionLockForTesting,
  type SessionLock,
} from '@/lib/recording/lock'
import { NoOpSessionPersistence } from '@/lib/recording/persistence/noop'
import { InMemorySessionPersistence } from '@/lib/recording/persistence/inMemory'
import type {
  PersistedSession,
  PersistedSessionPatch,
  SessionPersistence,
} from '@/lib/recording/persistence/types'
import {
  createFakeStream,
  installMediaRecorderMock,
} from '@/__mocks__/MediaRecorder'
import { setIdentity } from '@/lib/recording/sessionIdentity'

const CODEC = { mime: 'audio/webm', extension: 'webm' as const }

async function attach(): Promise<void> {
  await attachAndStart({
    stream: createFakeStream(),
    codec: CODEC,
    title: 'D',
    keyTerms: [],
    deviceId: null,
    maxBytes: 1024 * 1024,
  })
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Durable adapter whose chunk writes always reject, to trip the downgrade path. */
class FailingChunkPersistence implements SessionPersistence {
  readonly durable = true
  async putSession(_r: PersistedSession): Promise<void> {}
  async patchSession(_id: string, _p: PersistedSessionPatch): Promise<void> {}
  async getSession(): Promise<PersistedSession | null> {
    return null
  }
  async listSessions(): Promise<PersistedSession[]> {
    return []
  }
  async deleteSession(): Promise<void> {}
  async putChunk(): Promise<void> {
    throw new Error('quota exceeded')
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

class AlwaysAcquireLock implements SessionLock {
  async acquire(): Promise<boolean> {
    return true
  }
  async isHeld(): Promise<boolean> {
    return false
  }
  async release(): Promise<void> {}
}

class DeferredFirstChunkPersistence extends InMemorySessionPersistence {
  firstChunkStarted: Promise<void>
  rejectFirstChunk!: (err: Error) => void
  private resolveFirstChunkStarted!: () => void
  private hasDeferredChunk = false

  constructor() {
    super()
    this.firstChunkStarted = new Promise((resolve) => {
      this.resolveFirstChunkStarted = resolve
    })
  }

  override putChunk(
    sessionId: string,
    seq: number,
    blob: Blob
  ): Promise<void> {
    if (this.hasDeferredChunk) {
      return super.putChunk(sessionId, seq, blob)
    }

    this.hasDeferredChunk = true
    this.resolveFirstChunkStarted()
    return new Promise((_resolve, reject) => {
      this.rejectFirstChunk = reject
    })
  }
}

describe('durability snapshot wiring', () => {
  beforeEach(() => {
    __resetForTesting()
    installMediaRecorderMock()
    setIdentity({ userId: 'user-1', ready: true })
  })

  afterEach(() => {
    __setPersistenceForTesting(null)
    __setSessionLockForTesting(null)
    jest.restoreAllMocks()
  })

  test('starts unarmed when the adapter is not durable (unavailable from start)', async () => {
    __setPersistenceForTesting(new NoOpSessionPersistence())
    await attach()
    expect(getSnapshot().durable).toBe(false)
  })

  test('starts armed when the adapter is durable', async () => {
    __setPersistenceForTesting(new InMemorySessionPersistence())
    await attach()
    expect(getSnapshot().durable).toBe(true)
  })

  test('downgrades to unarmed when a chunk write fails mid-session', async () => {
    __setPersistenceForTesting(new FailingChunkPersistence())
    await attach()
    expect(getSnapshot().durable).toBe(true)

    recordChunk(new Blob([new Uint8Array(1024)]))
    await flushAsync()

    expect(getSnapshot().durable).toBe(false)
  })

  test('ignores a downgrade from an old queue after a new session starts', async () => {
    const persistence = new DeferredFirstChunkPersistence()
    __setPersistenceForTesting(persistence)
    __setSessionLockForTesting(new AlwaysAcquireLock())

    await attach()
    recordChunk(new Blob([new Uint8Array(1024)]))
    await persistence.firstChunkStarted

    discard()
    await attach()
    expect(getSnapshot().durable).toBe(true)

    persistence.rejectFirstChunk(new Error('old write failed'))
    await flushAsync()

    expect(getSnapshot().state).toBe('recording')
    expect(getSnapshot().durable).toBe(true)
  })
})
