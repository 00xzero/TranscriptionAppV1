/**
 * Client-side random id generation.
 *
 * Prefers `crypto.randomUUID()` and falls back to a timestamp+random string when
 * the Web Crypto API is unavailable (older/embedded browsers). The optional
 * prefix is only applied on the fallback path so the common path stays a bare
 * UUID.
 */
export function randomId(prefix = ''): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`
}
