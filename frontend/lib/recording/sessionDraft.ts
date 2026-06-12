import type { SessionDraft } from './sessionTypes'

const DRAFT_STORAGE_KEY = 'recording.sessionDraft'

export function writeDraft(draft: SessionDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch (err) {
    console.warn(
      `[recording] Failed to persist session draft (${DRAFT_STORAGE_KEY}):`,
      err
    )
  }
}

export function readDraft(): SessionDraft | null {
  if (typeof window === 'undefined') return null

  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<SessionDraft>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      generatedTitle:
        typeof parsed.generatedTitle === 'string' ? parsed.generatedTitle : null,
      keyTerms: Array.isArray(parsed.keyTerms)
        ? parsed.keyTerms.filter((t): t is string => typeof t === 'string')
        : [],
      codecMime: typeof parsed.codecMime === 'string' ? parsed.codecMime : null,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : null,
    }
  } catch {
    try {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      // ignore
    }
    return null
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // ignore
  }
}
