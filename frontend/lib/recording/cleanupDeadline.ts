export const LOCAL_CLEANUP_TIMEOUT_MS = 3_000

/** Allow the caller to move on and prevent new storage work after the deadline. */
export async function waitForLocalCleanup(work: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, LOCAL_CLEANUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([work(controller.signal).then(() => true), deadline])
  } finally {
    clearTimeout(timer)
  }
}
