import { useEffect, useMemo, useRef } from 'react'

/**
 * React state that queued work can read the moment it changes. `get` returns
 * the latest value, including updates made since the last render; `update`
 * applies an updater to both the value and the state, so it composes with any
 * other update made in the meantime.
 */
export type LiveStore<T> = {
  get(): T
  update(edit: (current: T) => T): void
}

export function useLiveStore<T>(
  value: T,
  setValue: React.Dispatch<React.SetStateAction<T>>
): LiveStore<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return useMemo<LiveStore<T>>(() => ({
    get: () => ref.current,
    update(edit) {
      ref.current = edit(ref.current)
      setValue(edit)
    },
  }), [setValue])
}
