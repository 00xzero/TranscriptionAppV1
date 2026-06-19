import {
  FakeOwnerLock,
  NoopOwnerLock,
  WebLocksOwnerLock,
  OWNER_LOCK_NAME,
} from '@/lib/recording/lock'

describe('FakeOwnerLock', () => {
  test('acquires when free, reports held, releases', async () => {
    const lock = new FakeOwnerLock()
    expect(await lock.isHeld()).toBe(false)
    expect(await lock.acquire()).toBe(true)
    expect(await lock.isHeld()).toBe(true)
    await lock.release()
    expect(await lock.isHeld()).toBe(false)
  })

  test('refuses to acquire when owned elsewhere', async () => {
    const lock = new FakeOwnerLock(true)
    expect(await lock.isHeld()).toBe(true)
    expect(await lock.acquire()).toBe(false)
  })
})

describe('NoopOwnerLock (no Web Locks fallback)', () => {
  // Without Web Locks there is no trustworthy cross-tab mutex, so the guard is
  // off: ownership is always granted and never reported held. Single-tab
  // recording still works; the only loss is same-browser duplicate-start blocking.
  test('always grants ownership and never reports held', async () => {
    const lock = new NoopOwnerLock()
    expect(await lock.isHeld()).toBe(false)
    expect(await lock.acquire()).toBe(true)
    // Still "free" after acquire — there is no real lock to observe.
    expect(await lock.isHeld()).toBe(false)
    await lock.release()
    expect(await lock.isHeld()).toBe(false)
  })

  test('a second tab can also acquire (the guard is intentionally off)', async () => {
    expect(await new NoopOwnerLock().acquire()).toBe(true)
    expect(await new NoopOwnerLock().acquire()).toBe(true)
  })
})

describe('WebLocksOwnerLock', () => {
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

  test('acquires the fixed owner-lock name and reports it held', async () => {
    const lock = new WebLocksOwnerLock()
    expect(await lock.acquire()).toBe(true)
    expect(heldNames).toContain(OWNER_LOCK_NAME)
    expect(await lock.isHeld()).toBe(true)
  })

  test('treats query failures as held so stale presence cannot become owner-lost', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn(),
        query: jest.fn(async () => {
          throw new Error('query failed')
        }),
      },
    })

    const lock = new WebLocksOwnerLock()
    expect(await lock.isHeld()).toBe(true)
  })

  test('returns false immediately when already held (ifAvailable)', async () => {
    available = false
    const lock = new WebLocksOwnerLock()
    expect(await lock.acquire()).toBe(false)
  })
})
