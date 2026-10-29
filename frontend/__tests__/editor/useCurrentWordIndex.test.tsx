import { act, renderHook } from '@testing-library/react'
import { useCurrentWordIndex } from '@/app/(app)/editor/[id]/hooks/useCurrentWordIndex'
import { createPlaybackClock, type PlaybackClock } from '@/app/(app)/editor/[id]/playbackClock'

const tokens = [{ startMs: 1000 }, { startMs: 1400 }, { startMs: 1400 }, { startMs: 2000 }]

function setup(enabled: boolean) {
  let ms = 0
  const inner = createPlaybackClock()
  inner.attach(() => ms)
  // Same clock, but it counts who is listening.
  const listening = new Set<() => void>()
  const clock: PlaybackClock = {
    ...inner,
    subscribe: (listener) => {
      listening.add(listener)
      const off = inner.subscribe(listener)
      return () => { listening.delete(listener); off() }
    },
  }
  const moveTo = (next: number) => {
    ms = next
    act(() => clock.refresh())
  }
  let renders = 0
  const hook = renderHook(
    ({ on }) => {
      renders++
      return useCurrentWordIndex({ tokens, enabled: on, clock })
    },
    { initialProps: { on: enabled } }
  )
  return { ...hook, moveTo, listeners: () => listening.size, renders: () => renders }
}

it('is null until the clock has a position', () => {
  const { result } = setup(true)
  expect(result.current).toBeNull()
})

it('is -1 before the first word, then the last word that has started', () => {
  const { result, moveTo } = setup(true)
  moveTo(500)
  expect(result.current).toBe(-1)
  moveTo(1000)
  expect(result.current).toBe(0)
  moveTo(1399)
  expect(result.current).toBe(0)
  moveTo(9000)
  expect(result.current).toBe(3)
})

it('makes the last of words sharing a start time current', () => {
  const { result, moveTo } = setup(true)
  moveTo(1400)
  expect(result.current).toBe(2)
})

it('follows backward seeks', () => {
  const { result, moveTo } = setup(true)
  moveTo(2100)
  expect(result.current).toBe(3)
  moveTo(1100)
  expect(result.current).toBe(0)
})

it('re-renders only when the current word changes', () => {
  const { moveTo, renders } = setup(true)
  moveTo(1000)
  const afterFirstWord = renders()
  moveTo(1100)
  moveTo(1200)
  moveTo(1300)
  expect(renders()).toBe(afterFirstWord)
  moveTo(1400)
  expect(renders()).toBe(afterFirstWord + 1)
})

it('is null and never listens when disabled', () => {
  const { result, moveTo, listeners } = setup(false)
  moveTo(1500)
  expect(result.current).toBeNull()
  expect(listeners()).toBe(0)
})

it('stops listening when editing starts and when the card unmounts', () => {
  const { result, rerender, unmount, moveTo, listeners } = setup(true)
  moveTo(1000)
  expect(result.current).toBe(0)
  expect(listeners()).toBe(1)

  rerender({ on: false })
  expect(listeners()).toBe(0)
  moveTo(2000)
  expect(result.current).toBeNull()

  rerender({ on: true })
  expect(listeners()).toBe(1)
  expect(result.current).toBe(3)

  unmount()
  expect(listeners()).toBe(0)
})
