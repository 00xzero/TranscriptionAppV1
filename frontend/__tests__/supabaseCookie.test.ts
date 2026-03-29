import {
  resolveSupabaseCookieName,
} from '../infra/supabase/cookie'

describe('resolveSupabaseCookieName', () => {
  const supabaseUrl = 'https://svzeffnmlqbdnjzhcgyx.supabase.co'

  test('prefers explicit cookie name when configured', () => {
    expect(
      resolveSupabaseCookieName({
        supabaseUrl,
        explicitCookieName: 'custom-cookie',
        availableCookies: [{ name: 'sb-svzeffnmlqbdnjzhcgyx-auth-token' }],
      })
    ).toBe('custom-cookie')
  })

  test('reuses the stable local cookie when present', () => {
    expect(
      resolveSupabaseCookieName({
        supabaseUrl,
        availableCookies: [{ name: 'sb-local-auth-token' }],
      })
    ).toBe('sb-local-auth-token')
  })

  test('reuses the legacy hosted Supabase cookie when present', () => {
    expect(
      resolveSupabaseCookieName({
        supabaseUrl,
        availableCookies: [{ name: 'sb-svzeffnmlqbdnjzhcgyx-auth-token' }],
      })
    ).toBe('sb-svzeffnmlqbdnjzhcgyx-auth-token')
  })

  test('reuses the legacy hosted Supabase cookie when only chunked cookies are present', () => {
    expect(
      resolveSupabaseCookieName({
        supabaseUrl,
        availableCookies: [
          { name: 'sb-svzeffnmlqbdnjzhcgyx-auth-token.0' },
          { name: 'sb-svzeffnmlqbdnjzhcgyx-auth-token.1' },
        ],
      })
    ).toBe('sb-svzeffnmlqbdnjzhcgyx-auth-token')
  })

  test('falls back to the stable local cookie for new sessions', () => {
    expect(
      resolveSupabaseCookieName({
        supabaseUrl,
        availableCookies: [],
      })
    ).toBe('sb-local-auth-token')
  })
})
