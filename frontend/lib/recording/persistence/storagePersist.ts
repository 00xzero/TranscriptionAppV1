/**
 * Best-effort request for durable browser storage. Failure does not block
 * recording — it only makes the session more likely to be evicted under pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return false
    }
    if (navigator.storage.persisted) {
      const already = await navigator.storage.persisted()
      if (already) return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
