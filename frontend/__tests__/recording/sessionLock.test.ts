import {
  FakeSessionLock,
  NoWebLocksSessionLock,
  WebLocksSessionLock,
  recordingLockName,
} from '@/lib/recording/lock'
import {
  InMemorySessionPersistence,
  type PersistedSession,
} from '@/lib/recording/persistence'

describe('FakeSessionLock', () => {
  test('acquires a free session and reports it held; releases it', async () => {
    const lock = new FakeSessionLock()
    expect(await lock.isHeld('s1')).toBe(false)
    expect(await lock.acquire('s1')).toBe(true)
    expect(await lock.isHeld('s1')).toBe(true)
    await lock.release()
    expect(await lock.isHeld('s1')).toBe(false)
  })

  test('refuses to acquire a session owned elsewhere', async () => {
    const lock = new FakeSessionLock(new Set(['s1']))
    expect(await lock.isHeld('s1')).toBe(true)
    expect(await lock.acquire('s1')).toBe(false)
  })
})

describe('NoWebLocksSessionLock (degraded fallback)', () => {
  function rowWith(lastChunkReceivedAt: number | null): PersistedSession {
    return {
      sessionId: 's1',
      userId: 'u1',
      uploadIntentId: 'i1',
      title: null,
      generatedTitle: null,
      keyTerms: [],
      codecMime: 'audio/webm',
      codecExtension: 'webm',
      deviceId: null,
      createdAt: 0,
      startedAt: 0,
      lastResumeAt: null,
      pausedAccumulatedMs: 0,
      bytesSoFar: 8192,
      lastChunkSeq: 1,
      lastChunkReceivedAt,
      phase: 'capturing',
      armed: true,
      failureReason: null,
    }
  }

  test('acquire always succeeds (no real coordination)', async () => {
    const lock = new NoWebLocksSessionLock(new InMemorySessionPersistence(), 30_000, () => 100_000)
    expect(await lock.acquire('s1')).toBe(true)
  })

  test('isHeld is true while chunks are fresh, false once stale', async () => {
    const persistence = new InMemorySessionPersistence()
    await persistence.putSession(rowWith(100_000))

    const fresh = new NoWebLocksSessionLock(persistence, 30_000, () => 110_000)
    expect(await fresh.isHeld('s1')).toBe(true) // 10s < 30s threshold

    const stale = new NoWebLocksSessionLock(persistence, 30_000, () => 200_000)
    expect(await stale.isHeld('s1')).toBe(false) // 100s > 30s threshold
  })

  test('isHeld is false for an unknown session', async () => {
    const lock = new NoWebLocksSessionLock(new InMemorySessionPersistence())
    expect(await lock.isHeld('missing')).toBe(false)
  })
})

describe('WebLocksSessionLock', () => {
  type LockCb = (lock: { name: string } | null) => unknown
  let heldNames: string[]
  let available: boolean
  let originalLocks: unknown

  beforeEach(() => {
    heldNames = []
    available = true
    originalLocks = (navigator as unknown as { locks?: unknown }).locks
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn((name: string, _opts: unknown, cb: LockCb) => {
          if (!available) return Promise.resolve(cb(null))
          heldNames.push(name)
          // Granted: callback's returned promise stays pending until release.
          return Promise.resolve(cb({ name }))
        }),
        query: jest.fn(async () => ({
          held: heldNames.map((name) => ({ name })),
          pending: [],
        })),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: originalLocks,
    })
  })

  test('acquires when available and reports the lock held by name', async () => {
    const lock = new WebLocksSessionLock()
    expect(await lock.acquire('s1')).toBe(true)
    expect(heldNames).toContain(recordingLockName('s1'))
    expect(await lock.isHeld('s1')).toBe(true)
  })

  test('returns false immediately when the lock is not available (ifAvailable)', async () => {
    available = false
    const lock = new WebLocksSessionLock()
    expect(await lock.acquire('s1')).toBe(false)
  })

  test('treats query failures as not-held (mirror of the owner lock policy)', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn(),
        query: jest.fn(async () => {
          throw new Error('query failed')
        }),
      },
    })

    const lock = new WebLocksSessionLock()
    expect(await lock.isHeld('s1')).toBe(false)
  })
})
