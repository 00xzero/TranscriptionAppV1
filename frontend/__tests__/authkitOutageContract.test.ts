/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

// proxy.ts tells a WorkOS outage from a sign-out by whether AuthKit deleted
// the session cookie. This runs the installed AuthKit itself (Jest can't load
// its ESM-only build) against a local stand-in for WorkOS, so an AuthKit
// upgrade that changes that answer fails here.
describe('AuthKit, as proxy.ts relies on it', () => {
  const root = path.resolve(__dirname, '..')
  const results = JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', './scripts/authkit-contract/register.mjs', 'scripts/authkit-contract/outage-probe.mjs'],
      { cwd: root, encoding: 'utf8', timeout: 30_000 }
    )
  ) as Record<string, { user: string | null; cookieDeleted: boolean }>

  test('existing attempt seals and rollback remain compatible with AuthKit\'s sealing dependency', () => {
    expect(results['mixed iron-session compatibility']).toEqual({ existingAttempt: true, rollback: true })
  })

  test.each(['signing keys unreachable', 'expired token, refresh service down'])(
    'an outage (%s) finds no user and keeps the session cookie',
    (name) => {
      expect(results[name]).toEqual({ user: null, cookieDeleted: false })
    }
  )

  test.each([
    'expired token, refresh refused',
    'invalid token',
    'unreadable cookie',
    'cookie sealed with another password',
  ])('a session that is over (%s) finds no user and deletes the cookie', (name) => {
    expect(results[name]).toEqual({ user: null, cookieDeleted: true })
  })

  test.each(['valid session', 'expired token, refresh works'])('a working session (%s) finds the user', (name) => {
    expect(results[name]).toEqual({ user: 'user_A', cookieDeleted: false })
  })

  test.each(['valid session', 'expired token, refresh works'])(
    '%s returns valid SDK v12 user timestamps, including from existing seals',
    (name) => {
      expect(results[`${name} timestamps`]).toEqual({
        createdAt: true,
        updatedAt: true,
        lastSignInAt: true,
      })
    }
  )
})
