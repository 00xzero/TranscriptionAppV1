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

/**
 * A version 4 UUID, for ids the database stores. `crypto.randomUUID` exists
 * only in secure contexts, so the editor opened at a LAN address over http
 * builds one from `getRandomValues`, which is available everywhere.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
