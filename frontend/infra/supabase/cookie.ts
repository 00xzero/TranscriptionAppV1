type CookieLike = { name: string }

const DEFAULT_LOCAL_COOKIE_NAME = 'sb-local-auth-token'

function hasCookieWithNameOrChunks(
  cookieNames: Set<string>,
  cookieName: string,
) {
  if (cookieNames.has(cookieName)) return true

  for (const existingCookieName of cookieNames) {
    if (existingCookieName.startsWith(`${cookieName}.`)) {
      return true
    }
  }

  return false
}

function getCloudTranscriptRef(supabaseUrl: string): string | null {
  try {
    const hostname = new URL(supabaseUrl).hostname
    if (!hostname.endsWith('.supabase.co')) return null

    const [transcriptRef] = hostname.split('.')
    return transcriptRef || null
  } catch {
    return null
  }
}

function getLegacyCookieName(supabaseUrl: string): string | null {
  const transcriptRef = getCloudTranscriptRef(supabaseUrl)
  return transcriptRef ? `sb-${transcriptRef}-auth-token` : null
}

export function resolveSupabaseCookieName(opts: {
  supabaseUrl: string
  explicitCookieName?: string
  availableCookies?: CookieLike[]
}) {
  const { supabaseUrl, explicitCookieName, availableCookies = [] } = opts

  if (explicitCookieName) return explicitCookieName

  const cookieNames = new Set(availableCookies.map((cookie) => cookie.name))

  if (hasCookieWithNameOrChunks(cookieNames, DEFAULT_LOCAL_COOKIE_NAME)) {
    return DEFAULT_LOCAL_COOKIE_NAME
  }

  const legacyCookieName = getLegacyCookieName(supabaseUrl)
  if (
    legacyCookieName &&
    hasCookieWithNameOrChunks(cookieNames, legacyCookieName)
  ) {
    return legacyCookieName
  }

  return DEFAULT_LOCAL_COOKIE_NAME
}

export function getBrowserSupabaseCookieName(supabaseUrl: string) {
  const explicitCookieName = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME

  if (typeof document === 'undefined') {
    return resolveSupabaseCookieName({ supabaseUrl, explicitCookieName })
  }

  const availableCookies = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      return {
        name: separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie,
      }
    })

  return resolveSupabaseCookieName({
    supabaseUrl,
    explicitCookieName,
    availableCookies,
  })
}

export function getServerSupabaseCookieName(
  supabaseUrl: string,
  availableCookies: CookieLike[],
) {
  return resolveSupabaseCookieName({
    supabaseUrl,
    explicitCookieName: process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME,
    availableCookies,
  })
}
