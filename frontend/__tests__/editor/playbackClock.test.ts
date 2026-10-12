import { createPlaybackClock } from '@/app/editor/[id]/playbackClock'

let frames: Map<number, FrameRequestCallback>
let nextFrame: number

beforeEach(() => {
  frames = new Map()
  nextFrame = 0
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.set(++nextFrame, cb)
    return nextFrame
  })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
})

afterEach(() => jest.restoreAllMocks())

function clockReading(readMs: () => number) {
  const clock = createPlaybackClock()
  clock.attach(readMs)
  return clock
}

function runFrame() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((cb) => cb(16))
}

it('has no position until it first reads one', () => {
  const clock = clockReading(() => 1234)
  expect(clock.getMs()).toBeNull()
  clock.refresh()
  expect(clock.getMs()).toBe(1234)
})

it('reads nothing while no player is attached', () => {
  const clock = createPlaybackClock()
  const listener = jest.fn()
  clock.subscribe(listener)
  clock.refresh()
  clock.start()
  runFrame()
  clock.stop()
  expect(clock.getMs()).toBeNull()
  expect(listener).not.toHaveBeenCalled()

  clock.attach(() => 500)
  clock.refresh()
  expect(clock.getMs()).toBe(500)
  clock.attach(null)
  clock.refresh()
  expect(clock.getMs()).toBe(500)
})

it('notifies subscribers only when the position changes', () => {
  let ms = 100
  const clock = clockReading(() => ms)
  const listener = jest.fn()
  const unsubscribe = clock.subscribe(listener)

  clock.refresh()
  clock.refresh()
  expect(listener).toHaveBeenCalledTimes(1)

  ms = 200
  clock.refresh()
  expect(listener).toHaveBeenCalledTimes(2)

  unsubscribe()
  ms = 300
  clock.refresh()
  expect(listener).toHaveBeenCalledTimes(2)
})

it('reads every animation frame while started and not at all once stopped', () => {
  let ms = 0
  const readMs = jest.fn(() => ms)
  const clock = clockReading(readMs)

  clock.start()
  clock.start() // a second start does not run a second loop
  expect(frames.size).toBe(1)

  ms = 40
  runFrame()
  expect(clock.getMs()).toBe(40)
  ms = 80
  runFrame()
  expect(clock.getMs()).toBe(80)

  clock.stop()
  expect(frames.size).toBe(0)
  const reads = readMs.mock.calls.length
  ms = 120
  runFrame()
  expect(readMs).toHaveBeenCalledTimes(reads)
  expect(clock.getMs()).toBe(80)
})

it('follows the source through backward jumps and rate changes', () => {
  // The source is the media element itself, so a seek back or a faster rate
  // shows up as whatever position it reports next.
  const positions = [5000, 5100, 2000, 2400, 2800]
  let i = 0
  const clock = clockReading(() => positions[Math.min(i, positions.length - 1)])
  const seen: number[] = []
  clock.subscribe(() => seen.push(clock.getMs()!))

  clock.start()
  for (i = 1; i < positions.length; i++) runFrame()
  clock.stop()

  expect(seen).toEqual(positions)
})
