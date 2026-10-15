import { useCallback, useMemo, useState } from 'react'
import { ZodError } from 'zod'
import { isUncertainOutcome } from '@/lib/people/errors'
import { useAfterUnmount } from '@/lib/hooks/useAfterUnmount'

/** Waits between resends of an unanswered request; the last repeats. */
export const RESEND_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const

/**
 * A refusal that came after an earlier attempt went unanswered. That attempt
 * may have committed, so the refusal says nothing about whether the write
 * happened: the caller reads the database again rather than rolling back.
 */
export class OutcomeUnknown extends Error {
  constructor(readonly refusal: unknown) {
    super('A write went unanswered and was then refused')
  }
}

/** The editor closed while a request was waiting; nothing further is sent. */
export class SendClosed extends Error {
  constructor() {
    super('The editor closed before the request was answered')
  }
}

export type Send = <T>(call: () => Promise<T>) => Promise<T>

export type Sender = {
  send: Send
  /** True while a call has gone unanswered twice in a row and is still being resent. */
  isReconnecting(): boolean
  close(): void
}

/**
 * Sends a request until the database answers it. The editor's writes all
 * recognise their own earlier success, so resending one whose answer was lost
 * is safe: if it committed, the resend finds what it intended and says done.
 *
 * `call` must send a request built before `send` was called, never reading
 * live state, so every resend is the first request again. Attempts never
 * overlap: the next is made only after the last failed and its wait ended,
 * at the backoff timer or the window's `online` event, whichever is first.
 * Closing settles every send at once with SendClosed, including one whose
 * request is still out; its answer, if it comes, is ignored. A closed
 * sender stays closed.
 */
export function createSender(onReconnecting: (reconnecting: boolean) => void): Sender {
  let closed = false
  // The sends showing Reconnecting; closing forgets them all.
  const reconnecting = new Set<object>()
  const wakers = new Set<() => void>()
  const stoppers = new Set<() => void>()

  const showReconnecting = (token: object, on: boolean) => {
    const was = reconnecting.size > 0
    if (on) reconnecting.add(token)
    else reconnecting.delete(token)
    if (was !== reconnecting.size > 0) onReconnecting(reconnecting.size > 0)
  }

  const wait = (ms: number) => new Promise<void>((resolve) => {
    const wake = () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', wake)
      wakers.delete(wake)
      resolve()
    }
    const timer = window.setTimeout(wake, ms)
    window.addEventListener('online', wake)
    wakers.add(wake)
  })

  // One attempt, settled early with SendClosed if the editor closes while it is out.
  const attempt = <T>(call: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const stop = () => reject(new SendClosed())
    stoppers.add(stop)
    void Promise.resolve().then(call).then(resolve, reject).finally(() => stoppers.delete(stop))
  })

  const send: Send = async (call) => {
    if (closed) throw new SendClosed()
    const token = {}
    let unanswered = 0
    try {
      for (;;) {
        try {
          return await attempt(call)
        } catch (error) {
          if (error instanceof SendClosed) throw error
          // An answer that could not be read came back after the database
          // acted: whether the write happened is unknown, never a refusal.
          if (error instanceof ZodError) throw new OutcomeUnknown(error)
          if (!isUncertainOutcome(error)) throw unanswered > 0 ? new OutcomeUnknown(error) : error
        }
        unanswered++
        if (closed) throw new SendClosed()
        // One lost answer is a blip; a second one in a row is worth showing.
        if (unanswered === 2) showReconnecting(token, true)
        await wait(RESEND_DELAYS_MS[Math.min(unanswered, RESEND_DELAYS_MS.length) - 1])
        if (closed) throw new SendClosed()
      }
    } finally {
      showReconnecting(token, false)
    }
  }

  return {
    send,
    isReconnecting: () => reconnecting.size > 0,
    close() {
      closed = true
      if (reconnecting.size > 0) { reconnecting.clear(); onReconnecting(false) }
      for (const stop of [...stoppers]) stop()
      for (const wake of [...wakers]) wake()
    },
  }
}

/**
 * The editor's sender, open while the editor is mounted. Closing waits for
 * the current task: an effect run again at once (Fast Refresh, Strict Mode)
 * finds it still open, so sends out at that moment are not given up while
 * the editor stays.
 */
export function useUntilAnswered(): { send: Send; reconnecting: boolean; isReconnecting(): boolean } {
  const [reconnecting, setReconnecting] = useState(false)
  const sender = useMemo(() => createSender(setReconnecting), [])
  useAfterUnmount(useCallback(() => () => sender.close(), [sender]))
  return { send: sender.send, reconnecting, isReconnecting: sender.isReconnecting }
}
