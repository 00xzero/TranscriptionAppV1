import type { BrowserOwnerLock } from './ownerTypes'

/**
 * No-op owner mutex for browsers without the Web Locks API.
 *
 * Same-browser duplicate-start protection requires a real cross-tab mutex; the
 * only one we trust is Web Locks. Rather than emulate one with localStorage +
 * heartbeats (which can falsely declare a live-but-backgrounded owner gone), we
 * degrade bluntly: ownership is always granted and never reported held, so
 * single-tab recording works everywhere and the second-tab guard is simply off.
 *
 * The cost is that two tabs in such a browser can each start a recording. That is
 * a self-inflicted duplicate-upload annoyance on a vanishing browser population
 * (Web Locks has shipped in every major engine since 2022), not data loss:
 * recordings stay durable and crash recovery is unaffected (it relies on
 * IndexedDB + the app-level recovery probe, not on this lock).
 */
export class NoopOwnerLock implements BrowserOwnerLock {
  async acquire(): Promise<boolean> {
    return true
  }

  async isHeld(): Promise<boolean> {
    return false
  }

  async release(): Promise<void> {}
}
