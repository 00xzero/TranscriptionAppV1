import { StrictMode, createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { z } from 'zod'
import { ATTEMPT_STALL_MS, OutcomeUnknown, RESEND_DELAYS_MS, SendClosed, createSender, useUntilAnswered } from '@/lib/editor/untilAnswered'

const LOST = { code: '', message: 'TypeError: Failed to fetch' }
const REFUSED = { code: 'SP002', message: 'changed since' }

// Lets the sender's awaited call settle before the next timer step.
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('sending until answered', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  function setup() {
    const reconnecting = jest.fn()
    const sender = createSender(reconnecting)
    return { sender, reconnecting }
  }

  it('returns an answer at once, without showing anything', async () => {
    const { sender, reconnecting } = setup()
    await expect(sender.send(async () => 'done')).resolves.toBe('done')
    expect(reconnecting).not.toHaveBeenCalled()
  })

  it('reports an error thrown by the app at once, never resending it', async () => {
    const { sender, reconnecting } = setup()
    const bug = new TypeError('cannot read properties of undefined')
    const call = jest.fn<Promise<string>, []>().mockRejectedValue(bug)
    await expect(sender.send(call)).rejects.toBe(bug)
    expect(call).toHaveBeenCalledTimes(1)
    expect(reconnecting).not.toHaveBeenCalled()
  })

  it("resends after a gateway page postgrest-js can't read, which carries no code", async () => {
    const { sender } = setup()
    const gateway = { message: '<html>502 Bad Gateway</html>' }
    const call = jest.fn<Promise<string>, []>().mockRejectedValueOnce(gateway).mockResolvedValue('done')
    const sent = sender.send(call)
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0])
    await expect(sent).resolves.toBe('done')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('shows Reconnecting while one attempt stays out, without sending it again', async () => {
    const { sender, reconnecting } = setup()
    let answer!: (value: string) => void
    const call = jest.fn(() => new Promise<string>((resolve) => { answer = resolve }))
    const sent = sender.send(call)
    await jest.advanceTimersByTimeAsync(ATTEMPT_STALL_MS - 1)
    expect(reconnecting).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(reconnecting).toHaveBeenLastCalledWith(true)
    expect(call).toHaveBeenCalledTimes(1)
    answer('done')
    await expect(sent).resolves.toBe('done')
    expect(reconnecting).toHaveBeenLastCalledWith(false)
  })

  it('resends the same call on the backoff schedule until answered', async () => {
    const { sender, reconnecting } = setup()
    const call = jest.fn<Promise<string>, []>()
      .mockRejectedValueOnce(LOST).mockRejectedValueOnce(LOST).mockRejectedValueOnce(LOST)
      .mockResolvedValue('done')
    const sent = sender.send(call)
    await flush()
    expect(call).toHaveBeenCalledTimes(1)
    // One lost answer is a blip: nothing shows yet.
    expect(reconnecting).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0])
    expect(call).toHaveBeenCalledTimes(2)
    expect(reconnecting).toHaveBeenLastCalledWith(true)
    expect(sender.isReconnecting()).toBe(true)
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[1] - 1)
    expect(call).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(1)
    expect(call).toHaveBeenCalledTimes(3)
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[2])
    await expect(sent).resolves.toBe('done')
    expect(call).toHaveBeenCalledTimes(4)
    expect(reconnecting).toHaveBeenLastCalledWith(false)
    expect(sender.isReconnecting()).toBe(false)
  })

  it('keeps resending every 15 seconds once the schedule runs out', async () => {
    const { sender } = setup()
    let attempts = 0
    const sent = sender.send(async () => { attempts++; if (attempts < 8) throw LOST; return 'done' })
    await flush()
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS.reduce((a, b) => a + b, 0))
    expect(attempts).toBe(6)
    await jest.advanceTimersByTimeAsync(15000)
    expect(attempts).toBe(7)
    await jest.advanceTimersByTimeAsync(15000)
    await expect(sent).resolves.toBe('done')
  })

  it('resends at once when the browser comes back online, never overlapping an attempt', async () => {
    const { sender } = setup()
    let finish: ((value: string) => void) | undefined
    const call = jest.fn<Promise<string>, []>()
      .mockRejectedValueOnce(LOST)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const sent = sender.send(call)
    await flush()
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(call).toHaveBeenCalledTimes(2)
    // The second attempt is still running: going online again starts nothing.
    window.dispatchEvent(new Event('online'))
    await jest.advanceTimersByTimeAsync(60000)
    expect(call).toHaveBeenCalledTimes(2)
    finish!('done')
    await expect(sent).resolves.toBe('done')
  })

  it('throws a refusal once, never resending it', async () => {
    const { sender } = setup()
    const call = jest.fn().mockRejectedValue(REFUSED)
    await expect(sender.send(call)).rejects.toBe(REFUSED)
    await jest.advanceTimersByTimeAsync(60000)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('reports a refusal after an unanswered attempt as an unknown outcome', async () => {
    const { sender, reconnecting } = setup()
    const call = jest.fn().mockRejectedValueOnce(LOST).mockRejectedValueOnce(LOST).mockRejectedValue(REFUSED)
    const sent = sender.send(call)
    const settled = expect(sent).rejects.toEqual(expect.any(OutcomeUnknown))
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0] + RESEND_DELAYS_MS[1])
    await settled
    expect(((await sent.catch((e: unknown) => e)) as OutcomeUnknown).refusal).toBe(REFUSED)
    expect(reconnecting).toHaveBeenLastCalledWith(false)
  })

  it('reports an answer it could not read as an unknown outcome, never a refusal', async () => {
    const { sender } = setup()
    const unreadable = () => z.object({ id: z.string() }).parse({})
    await expect(sender.send(async () => unreadable())).rejects.toEqual(expect.any(OutcomeUnknown))
  })

  it('stops when the editor closes, and sends nothing afterwards', async () => {
    const { sender, reconnecting } = setup()
    const call = jest.fn().mockRejectedValue(LOST)
    const sent = sender.send(call)
    const closed = expect(sent).rejects.toEqual(expect.any(SendClosed))
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0])
    sender.close()
    await closed
    await jest.advanceTimersByTimeAsync(60000)
    expect(call).toHaveBeenCalledTimes(2)
    expect(reconnecting).toHaveBeenLastCalledWith(false)

    const later = jest.fn()
    await expect(sender.send(later)).rejects.toEqual(expect.any(SendClosed))
    expect(later).not.toHaveBeenCalled()
  })

  it('settles a send whose request is still out when the editor closes, and ignores its late answer', async () => {
    const { sender, reconnecting } = setup()
    let answer!: (value: string) => void
    const call = jest.fn(() => new Promise<string>((resolve) => { answer = resolve }))
    const sent = sender.send(call)
    const closed = expect(sent).rejects.toEqual(expect.any(SendClosed))
    await flush()
    sender.close()
    await closed
    answer('late')
    await flush()
    expect(call).toHaveBeenCalledTimes(1)
    expect(reconnecting).not.toHaveBeenCalled()
  })

  it('settles a resend that is out when the editor closes, clearing Reconnecting', async () => {
    const { sender, reconnecting } = setup()
    const call = jest.fn<Promise<string>, []>().mockRejectedValueOnce(LOST).mockRejectedValueOnce(LOST)
      .mockImplementation(() => new Promise<string>(() => {}))
    const sent = sender.send(call)
    const closed = expect(sent).rejects.toEqual(expect.any(SendClosed))
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0] + RESEND_DELAYS_MS[1])
    expect(call).toHaveBeenCalledTimes(3)
    expect(sender.isReconnecting()).toBe(true)
    sender.close()
    await closed
    expect(sender.isReconnecting()).toBe(false)
    expect(reconnecting).toHaveBeenLastCalledWith(false)
  })
})

describe('the editor\'s sender', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)

  it('stays open through an effect run again at once, resending what goes unanswered', async () => {
    const { result } = renderHook(() => useUntilAnswered(), { wrapper: strict })
    await jest.advanceTimersByTimeAsync(1)
    const call = jest.fn().mockRejectedValueOnce(LOST).mockResolvedValue('read')
    const out = result.current.send(call)
    await jest.advanceTimersByTimeAsync(RESEND_DELAYS_MS[0])
    await expect(out).resolves.toBe('read')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('closes once the editor has gone, settling a request that is out', async () => {
    const { result, unmount } = renderHook(() => useUntilAnswered())
    const out = result.current.send(() => new Promise<string>(() => {}))
    const settled = expect(out).rejects.toEqual(expect.any(SendClosed))
    await flush()
    unmount()
    // Closed by a task of its own.
    await jest.advanceTimersByTimeAsync(1)
    await settled
  })
})
