export type History<T> = { done: readonly T[]; undone: readonly T[]; version: number }
export const emptyHistory = <T>(): History<T> => ({ done: [], undone: [], version: 0 })
export const record = <T>(h: History<T>, step: T): History<T> => ({ done: [...h.done, step].slice(-1000), undone: [], version: h.version + 1 })
export function takeUndo<T>(h: History<T>): [History<T>, T | undefined] {
  const step = h.done.at(-1)
  return step === undefined ? [h, undefined] : [{ done: h.done.slice(0, -1), undone: [...h.undone, step], version: h.version + 1 }, step]
}
export function takeRedo<T>(h: History<T>): [History<T>, T | undefined] {
  const step = h.undone.at(-1)
  return step === undefined ? [h, undefined] : [{ done: [...h.done, step], undone: h.undone.slice(0, -1), version: h.version + 1 }, step]
}
export const drop = <T>(h: History<T>, step: T): History<T> => ({ done: h.done.filter(s => s !== step), undone: h.undone.filter(s => s !== step), version: h.version + 1 })
