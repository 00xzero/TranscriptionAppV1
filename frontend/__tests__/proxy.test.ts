/** @jest-environment node */

import { NextRequest } from 'next/server'
import { proxy } from '../proxy'

const mockCreateServerClient = jest.fn()

jest.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}))

type ServerClientOptions = {
  cookies: {
    setAll: (
      cookies: Array<{
        name: string
        value: string
        options: { path?: string; httpOnly?: boolean }
      }>,
      headers: Record<string, string>
    ) => void
  }
}

describe('proxy', () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL
  const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    mockCreateServerClient.mockReset()
  })

  afterAll(() => {
    if (originalSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL
    } else {
      process.env.SUPABASE_URL = originalSupabaseUrl
    }

    if (originalSupabaseAnonKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey
    }
  })

  test('preserves Supabase cache-control headers with refreshed auth cookies', async () => {
    mockCreateServerClient.mockImplementation(
      (_url: string, _key: string, options: ServerClientOptions) => {
        options.cookies.setAll(
          [
            {
              name: 'sb-local-auth-token',
              value: 'refreshed-session',
              options: { path: '/', httpOnly: true },
            },
          ],
          {
            'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
            expires: '0',
            pragma: 'no-cache',
          }
        )

        return {
          auth: {
            getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
          },
        }
      }
    )

    const response = await proxy(new NextRequest('https://app.example.test/transcripts'))

    expect(response.cookies.get('sb-local-auth-token')).toMatchObject({
      value: 'refreshed-session',
      path: '/',
      httpOnly: true,
    })
    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0'
    )
    expect(response.headers.get('expires')).toBe('0')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })
})
