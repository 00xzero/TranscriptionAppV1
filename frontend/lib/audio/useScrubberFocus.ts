'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import type { FocusEvent } from 'react'

/** Remember ownership before inert/removal can make the browser blur a slider. */
export function useScrubberFocus(collapsed: boolean, engineOnly: boolean) {
  const expandedRef = useRef<HTMLDivElement | null>(null)
  const miniRef = useRef<HTMLDivElement | null>(null)
  const owner = useRef<{ region: 'expanded' | 'mini'; element: HTMLElement; pointer: boolean; blurred: boolean } | null>(null)
  const previous = useRef({ collapsed, engineOnly })
  const attachExpanded = useCallback((element: HTMLDivElement | null) => {
    expandedRef.current = element
  }, [])
  const attachMini = useCallback((element: HTMLDivElement | null) => {
    miniRef.current = element
  }, [])
  const trackExpandedFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    owner.current = { region: 'expanded', element: event.target, pointer: event.target.dataset.scrubPointerFocus === 'true', blurred: false }
  }, [])
  const trackMiniFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    owner.current = { region: 'mini', element: event.target, pointer: event.target.dataset.scrubPointerFocus === 'true', blurred: false }
  }, [])
  const trackBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.target === owner.current?.element) {
      owner.current.pointer = event.target.dataset.scrubPointerFocus === 'true'
      owner.current.blurred = true
    }
    // Keep ownership for browser blur caused by hiding/removing the control,
    // but discard it when the user deliberately moves focus away (even to body).
    if (event.target === owner.current?.element && event.target.isConnected && !event.target.closest('[inert]')) {
      owner.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const old = previous.current
    previous.current = { collapsed, engineOnly }
    const focused = owner.current
    if (!focused || (old.collapsed === collapsed && old.engineOnly === engineOnly)) return
    const active = document.activeElement
    if (active !== focused.element && active !== document.body) {
      owner.current = null
      return
    }
    const hidden = focused.region === 'expanded' ? collapsed : !collapsed
    if (!hidden && focused.element.isConnected) return
    // Input modality can change while the same slider stays focused.
    if (!focused.blurred) focused.pointer = focused.element.dataset.scrubPointerFocus === 'true'
    const region = collapsed ? miniRef.current : expandedRef.current
    const target = region?.querySelector<HTMLElement>('[role="slider"]')
    if (target) {
      if (focused.pointer) target.dataset.scrubPointerFocus = 'true'
      else delete target.dataset.scrubPointerFocus
      target.focus({ preventScroll: true })
    }
  }, [collapsed, engineOnly])

  return { attachExpanded, attachMini, trackExpandedFocus, trackMiniFocus, trackBlur }
}
