import { randomId } from '@/lib/ids'

/**
 * Stable per-tab client id. Generated once on first read and held in module state
 * for the tab's lifetime, so a tab can recognise and suppress its own presence
 * (and attribute heartbeats) without persisting anything.
 */
let clientId: string | null = null

export function getOwnerClientId(): string {
  if (!clientId) clientId = randomId('tab-')
  return clientId
}

/** Test hook: force a specific client id, or `null` to regenerate on next read. */
export function __setOwnerClientIdForTesting(id: string | null): void {
  clientId = id
}
