import { WebLocksMutex } from '@/lib/recording/lock/webLocksMutex'

type LockCb = (lock: { name: string } | null) => unknown

describe('WebLocksMutex', () => {
  let heldNames: string[]
  let available: boolean
  let originalLocks: unknown
  let requestImpl: (name: string, opts: unknown, cb: LockCb) => unknown
  let queryImpl: () => Promise<unknown>

  // Default mock: granting request + a query() that reports whatever has been
  // acquired. Individual tests override requestImpl/queryImpl for edge cases.
  const grantingRequest = (name: string, _opts: unknown, cb: LockCb) => {
    if (!available) return Promise.resolve(cb(null))
    heldNames.push(name)
    // Granted: the callback's returned (hold-open) promise stays pending until
    // release; acquire() still resolves synchronously inside it.
    return Promise.resolve(cb({ name }))
  }
  const reportingQuery = async () => ({
    held: heldNames.map((name) => ({ name })),
    pending: [],
  })

  beforeEach(() => {
    heldNames = []
    available = true
    requestImpl = grantingRequest
    queryImpl = reportingQuery
    originalLocks = (navigator as unknown as { locks?: unknown }).locks
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn((name: string, opts: unknown, cb: LockCb) =>
          requestImpl(name, opts, cb)
        ),
        query: jest.fn(() => queryImpl()),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: originalLocks,
    })
  })

  function mutex(onQueryFailure: 'held' | 'free' = 'free') {
    return new WebLocksMutex({ onQueryFailure })
  }

  describe('acquire / re-acquisition', () => {
    test('acquires a free lock by name and reports it held', async () => {
      const lock = mutex()
      expect(await lock.acquire('a')).toBe(true)
      expect(heldNames).toContain('a')
      expect(await lock.isHeld('a')).toBe(true)
    })

    test('requests an exclusive, non-blocking (ifAvailable) lock', async () => {
      // The ifAvailable flag is what makes acquire resolve instead of queueing
      // when the lock is held — pin it so a regression that drops it is caught.
      const lock = mutex()
      await lock.acquire('a')
      const requestMock = (navigator.locks as unknown as { request: jest.Mock }).request
      expect(requestMock).toHaveBeenCalledWith(
        'a',
        { mode: 'exclusive', ifAvailable: true },
        expect.any(Function)
      )
    })

    test('re-acquiring the same name while held returns true (no second request)', async () => {
      const lock = mutex()
      expect(await lock.acquire('a')).toBe(true)
      expect(await lock.acquire('a')).toBe(true)
      // The held name was only requested from the browser once.
      expect(heldNames.filter((n) => n === 'a')).toHaveLength(1)
    })

    test('re-acquiring a different name while held returns false', async () => {
      const lock = mutex()
      expect(await lock.acquire('a')).toBe(true)
      expect(await lock.acquire('b')).toBe(false)
      expect(heldNames).not.toContain('b')
    })

    test('release frees the holder so the name can be acquired again', async () => {
      const lock = mutex()
      expect(await lock.acquire('a')).toBe(true)
      await lock.release()
      expect(await lock.acquire('a')).toBe(true)
      expect(heldNames.filter((n) => n === 'a')).toHaveLength(2)
    })
  })

  describe('acquire failure paths', () => {
    test('resolves false (without blocking) on an ifAvailable miss', async () => {
      available = false
      const lock = mutex()
      expect(await lock.acquire('a')).toBe(false)
    })

    test('resolves false when navigator.locks.request throws synchronously', async () => {
      requestImpl = () => {
        throw new Error('boom')
      }
      const lock = mutex()
      await expect(lock.acquire('a')).resolves.toBe(false)
    })

    test('resolves false when the request() promise rejects', async () => {
      requestImpl = () => Promise.reject(new Error('rejected'))
      const lock = mutex()
      await expect(lock.acquire('a')).resolves.toBe(false)
    })
  })

  describe('isHeld query-failure policy', () => {
    test("onQueryFailure: 'free' reports not-held when query() throws", async () => {
      queryImpl = async () => {
        throw new Error('query failed')
      }
      expect(await mutex('free').isHeld('a')).toBe(false)
    })

    test("onQueryFailure: 'held' reports held when query() throws", async () => {
      queryImpl = async () => {
        throw new Error('query failed')
      }
      expect(await mutex('held').isHeld('a')).toBe(true)
    })

    test('isHeld is false for a name no holder owns', async () => {
      expect(await mutex().isHeld('nobody')).toBe(false)
    })
  })
})
