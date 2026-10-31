import { safeReturnPath } from '@/lib/auth/return-path'

describe('safeReturnPath', () => {
  test('keeps a path within the app, with its query', () => {
    expect(safeReturnPath('/editor/abc?t=12')).toBe('/editor/abc?t=12')
    expect(safeReturnPath('/projects/p1')).toBe('/projects/p1')
  })

  test('falls back to the Library for anything off-site, odd or missing', () => {
    for (const path of [null, undefined, '', 'editor', '//evil.test/x', '/\\evil.test', 'https://evil.test/x', 'javascript:alert(1)']) {
      expect(safeReturnPath(path)).toBe('/')
    }
  })

  test('never sends anyone back into sign-in', () => {
    for (const path of ['/auth', '/auth?next=/x', '/auth/callback?code=c', '/auth/finish?to=/']) {
      expect(safeReturnPath(path)).toBe('/')
    }
  })
})
