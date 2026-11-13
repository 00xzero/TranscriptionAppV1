export const LOCAL_CLEANUP_TIMEOUT_MS = 3_000

/** Allow the caller to move on and prevent new storage work after the deadline. */
export function startLocalCleanup(work: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, LOCAL_CLEANUP_TIMEOUT_MS)
  })
  const completion = Promise.resolve().then(() => work(controller.signal))
  const withinDeadline = Promise.race([completion.then(() => true), deadline])
    .finally(() => clearTimeout(timer))
  return { withinDeadline, completion }
}

export function waitForLocalCleanup(work: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
  return startLocalCleanup(work).withinDeadline
}
