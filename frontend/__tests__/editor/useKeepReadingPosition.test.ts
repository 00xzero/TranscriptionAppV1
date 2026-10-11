import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useKeepReadingPosition } from '@/app/editor/[id]/hooks/useKeepReadingPosition'
import type { Seg } from '@/app/editor/[id]/types'

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

/**
 * A transcript scroller with one card, laid out by hand: the card sits
 * `cardOffset` px down the content, so on screen it is at cardOffset - scrollTop.
 */
function setup() {
  const container = document.createElement('div')
  const card = document.createElement('div')
  card.dataset.segmentId = 's5'
  container.appendChild(card)
  document.body.appendChild(container)
  const layout = { cardOffset: 1200 }
  container.getBoundingClientRect = () => rect(0, 800)
  card.getBoundingClientRect = () => rect(layout.cardOffset - container.scrollTop, 60)
  container.scrollTop = 1000 // the card is 200px below the top

  let frames: FrameRequestCallback[] = []
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { frames = [] })
  const runFrames = (count: number) => {
    for (let i = 0; i < count; i++) {
      const due = frames
      frames = []
      due.forEach((callback) => callback(performance.now()))
    }
  }

  const { result } = renderHook(() => {
    const [, setOpen] = useState(false)
    const position = useKeepReadingPosition({
      scrollRef: { current: container },
      virtuosoRef: { current: null },
      segments: [{ id: 's5' } as Seg],
      activeSegId: undefined,
      markProgrammaticScroll: () => {},
    })
    return { ...position, toggle: () => setOpen((open) => !open) }
  })
  // What opening the sidebar does: keep the place across the render it causes.
  const toggleKeepingPlace = () => act(() => { result.current.keepReadingPosition(result.current.toggle) })

  return { container, layout, result, runFrames, toggleKeepingPlace, cleanup: () => container.remove() }
}

afterEach(() => jest.restoreAllMocks())

describe('useKeepReadingPosition', () => {
  test('holds the reading line while the rewrapped layout settles', () => {
    const { container, layout, runFrames, toggleKeepingPlace, cleanup } = setup()
    toggleKeepingPlace()

    // Rows above the card rewrap taller, pushing it 100px down.
    layout.cardOffset = 1300
    runFrames(1)
    expect(container.scrollTop).toBe(1100)
    cleanup()
  })

  test('a jump released during the settling window is not scrolled back', () => {
    const { container, result, runFrames, toggleKeepingPlace, cleanup } = setup()
    toggleKeepingPlace()

    // The sidebar jumps far down the transcript before the hold has settled.
    act(() => result.current.releaseReadingPosition())
    container.scrollTop = 5000
    runFrames(10)
    expect(container.scrollTop).toBe(5000)
    cleanup()
  })

  test('input outside the transcript, such as a sidebar click, ends the hold', () => {
    const { container, runFrames, toggleKeepingPlace, cleanup } = setup()
    toggleKeepingPlace()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    container.scrollTop = 5000
    runFrames(10)
    expect(container.scrollTop).toBe(5000)
    cleanup()
  })

  test('without a release, the hold would undo the jump (the race the release prevents)', () => {
    const { container, runFrames, toggleKeepingPlace, cleanup } = setup()
    toggleKeepingPlace()

    container.scrollTop = 5000
    runFrames(1)
    expect(container.scrollTop).toBe(1000)
    cleanup()
  })
})
