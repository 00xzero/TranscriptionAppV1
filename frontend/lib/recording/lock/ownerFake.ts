import type { BrowserOwnerLock } from './ownerTypes'

/**
 * In-memory owner mutex fake for unit tests.
 *
 * `ownedElsewhere` simulates another tab already holding the owner lock: while
 * set, `acquire` fails and `isHeld` is true regardless of local state.
 */
export class FakeOwnerLock implements BrowserOwnerLock {
  private held = false

  constructor(public ownedElsewhere = false) {}

  async acquire(): Promise<boolean> {
    if (this.ownedElsewhere) return false
    this.held = true
    return true
  }

  async isHeld(): Promise<boolean> {
    return this.ownedElsewhere || this.held
  }

  async release(): Promise<void> {
    this.held = false
  }
}
