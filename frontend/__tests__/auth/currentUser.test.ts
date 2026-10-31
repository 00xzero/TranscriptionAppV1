/** @jest-environment node */

import { withAuth } from '@workos-inc/authkit-nextjs'
import { getCurrentUser } from '@/lib/auth/current-user.server'
import { provisionAppUser } from '@/lib/auth/provision-app-user.server'

const withAuthMock = withAuth as unknown as jest.Mock

describe('getCurrentUser', () => {
  const rpc = jest.fn()
  const supabase = { rpc } as never

  beforeEach(() => {
    jest.clearAllMocks()
    withAuthMock.mockResolvedValue({ user: null })
  })

  test('is null without a WorkOS session, and never looks up an id', async () => {
    await expect(getCurrentUser(supabase)).resolves.toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  test('resolves the WorkOS user to our own id through the caller’s client', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01A', email: 'ada@example.com' } })
    rpc.mockResolvedValue({ data: 'app-user-a', error: null })

    await expect(getCurrentUser(supabase)).resolves.toEqual({
      id: 'app-user-a',
      email: 'ada@example.com',
    })
    expect(rpc).toHaveBeenCalledWith('current_user_id')
  })

  test('is null for a WorkOS user with no app_users row', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_unlinked', email: 'x@example.com' } })
    rpc.mockResolvedValue({ data: null, error: null })

    await expect(getCurrentUser(supabase)).resolves.toBeNull()
  })

  test('throws when the lookup itself fails, rather than calling it signed out', async () => {
    withAuthMock.mockResolvedValue({ user: { id: 'user_01A', email: 'ada@example.com' } })
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    await expect(getCurrentUser(supabase)).rejects.toEqual({ message: 'connection reset' })
  })
})

describe('provisionAppUser', () => {
  // A tiny app_users table with the real constraint: one row per WorkOS id.
  function fakeAdmin() {
    const rows: Array<{ id: string; workos_user_id: string }> = []
    let nextId = 0
    const upsert = jest.fn(
      async (row: { workos_user_id: string }, options: unknown) => {
        if (!rows.some((existing) => existing.workos_user_id === row.workos_user_id)) {
          nextId += 1
          rows.push({ id: `app-user-${nextId}`, ...row })
        }
        return { error: null, options }
      }
    )
    const from = jest.fn(() => ({
      upsert,
      select: () => ({
        eq: (_column: string, workosUserId: string) => ({
          single: async () => {
            const row = rows.find((candidate) => candidate.workos_user_id === workosUserId)
            return row ? { data: { id: row.id }, error: null } : { data: null, error: { message: 'none' } }
          },
        }),
      }),
    }))
    return { admin: { from } as never, rows, upsert }
  }

  test('creates a row on first sign-in, without overwriting on conflict', async () => {
    const { admin, rows, upsert } = fakeAdmin()

    await expect(provisionAppUser(admin, 'user_01A')).resolves.toBe(
      'app-user-1'
    )
    expect(rows).toEqual([{ id: 'app-user-1', workos_user_id: 'user_01A' }])
    expect(upsert).toHaveBeenCalledWith(
      { workos_user_id: 'user_01A' },
      { onConflict: 'workos_user_id', ignoreDuplicates: true }
    )
  })

  test('a returning user gets the same id', async () => {
    const { admin, rows } = fakeAdmin()

    const first = await provisionAppUser(admin, 'user_01A')
    const again = await provisionAppUser(admin, 'user_01A')

    expect(again).toBe(first)
    expect(rows).toHaveLength(1)
  })

  test('two sign-ins at once resolve to one id', async () => {
    const { admin, rows } = fakeAdmin()

    const ids = await Promise.all([
      provisionAppUser(admin, 'user_01A'),
      provisionAppUser(admin, 'user_01A'),
    ])

    expect(new Set(ids).size).toBe(1)
    expect(rows).toHaveLength(1)
  })

  test('fails loudly when the row cannot be written', async () => {
    const from = jest.fn(() => ({
      upsert: async () => ({ error: { message: 'permission denied' } }),
    }))

    await expect(provisionAppUser({ from } as never, 'user_01A')).rejects.toEqual({ message: 'permission denied' })
  })
})
