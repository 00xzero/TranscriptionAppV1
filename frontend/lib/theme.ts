import type { AppTheme } from '@/types/theme'

export const APP_THEME_STORAGE_KEY = 'app-theme'
export const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export type ResolvedAppTheme = 'light' | 'dark'

interface AppThemeSelection {
  preference: AppTheme
  resolvedTheme: ResolvedAppTheme
}

export function normalizeAppThemePreference(storedTheme: string | null): AppTheme {
  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme
  }
  if (storedTheme === 'blue') return 'dark'
  return 'system'
}

export function resolveAppTheme(
  preference: AppTheme,
  systemPrefersDark: boolean
): ResolvedAppTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function resolveInitialAppTheme(
  storedTheme: string | null,
  canUseSystemTheme: boolean,
  systemPrefersDark: boolean
): AppThemeSelection {
  const normalizedPreference = normalizeAppThemePreference(storedTheme)
  const preference =
    normalizedPreference === 'system' && !canUseSystemTheme
      ? resolveAppTheme('system', systemPrefersDark)
      : normalizedPreference

  return {
    preference,
    resolvedTheme: resolveAppTheme(preference, systemPrefersDark),
  }
}

export function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_MODE_MEDIA_QUERY).matches
  )
}

export function supportsSystemThemePreference() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  const mql = window.matchMedia(DARK_MODE_MEDIA_QUERY)
  return (
    typeof mql.addEventListener === 'function' &&
    typeof mql.removeEventListener === 'function'
  )
}

export function detectInitialTheme(canUseSystemTheme: boolean): AppTheme {
  try {
    return resolveInitialAppTheme(
      localStorage.getItem(APP_THEME_STORAGE_KEY),
      canUseSystemTheme,
      systemPrefersDark()
    ).preference
  } catch { }

  return resolveInitialAppTheme(null, canUseSystemTheme, systemPrefersDark()).preference
}

export function applyThemePreference(preference: AppTheme) {
  if (typeof document === 'undefined') return

  document.documentElement.classList.toggle(
    'dark',
    resolveAppTheme(preference, systemPrefersDark()) === 'dark'
  )

  try { localStorage.setItem(APP_THEME_STORAGE_KEY, preference) } catch { }
}

export function createThemeInitScript() {
  return `(function(){try{var q=${JSON.stringify(DARK_MODE_MEDIA_QUERY)};var m=typeof window!=='undefined'&&typeof window.matchMedia==='function';var l=m?window.matchMedia(q):null;var c=!!(l&&typeof l.addEventListener==='function'&&typeof l.removeEventListener==='function');var s=localStorage.getItem(${JSON.stringify(APP_THEME_STORAGE_KEY)});var p=(s==='light'||s==='dark'||s==='system')?s:(s==='blue'?'dark':'system');if(p==='system'&&!c){p=l&&l.matches?'dark':'light';}var r=p==='system'?(l&&l.matches?'dark':'light'):p;document.documentElement.classList.toggle('dark',r==='dark');}catch(e){}})();`
}
