import { fireEvent } from '@testing-library/react'

// jsdom lacks PointerEvent. Supply real MouseEvent coordinates plus the pointer
// fields consumed by React, without pretending to implement pointer capture.
type PointerInit = MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean }
const positions = new WeakMap<EventTarget, PointerInit>()
function dispatch(target: Element, type: string, init: PointerInit = {}) {
  const props = { button: 0, clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...positions.get(target), ...init }
  positions.set(target, props)
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...props })
  for (const key of ['pointerId', 'pointerType', 'isPrimary'] as const) Object.defineProperty(event, key, { value: props[key] })
  return fireEvent(target, event)
}
export const pointer = {
  down: (target: Element, init?: PointerInit) => dispatch(target, 'pointerdown', init),
  move: (target: Element, init?: PointerInit) => dispatch(target, 'pointermove', init),
  up: (target: Element, init?: PointerInit) => dispatch(target, 'pointerup', init),
  cancel: (target: Element, init?: PointerInit) => dispatch(target, 'pointercancel', init),
  lost: (target: Element, init?: PointerInit) => dispatch(target, 'lostpointercapture', init),
}
