/**
 * A stand-in for Next's `cookies()` store, for code that reads and writes
 * cookies through `next/headers`. Suites wire it in with
 * `jest.mock('next/headers', () => ({ cookies: async () => mockJar.jar, … }))`.
 */
export interface StoredCookie {
  value: string
  options?: Record<string, unknown>
}

export function createCookieJar() {
  const store = new Map<string, StoredCookie>()
  const jar = {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
    getAll: () => [...store].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      store.set(name, { value, options })
    },
    delete: (target: string | { name: string }) => {
      store.delete(typeof target === 'string' ? target : target.name)
    },
  }
  return { store, jar, names: () => [...store.keys()].sort(), clear: () => store.clear() }
}
