"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & {
  /** Keep the trigger mounted while preventing and dismissing tooltip content. */
  disabled?: boolean
}

const Tooltip = ({
  disabled = false,
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: TooltipProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const blockPointerOpenRef = React.useRef(false)
  const isControlled = openProp !== undefined
  const open = disabled ? false : isControlled ? openProp : uncontrolledOpen

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && disabled) {
        return
      }

      if (nextOpen && blockPointerOpenRef.current) {
        return
      }

      if (nextOpen && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      if (!isControlled) {
        setUncontrolledOpen(nextOpen)
      }

      onOpenChange?.(nextOpen)
    },
    [disabled, isControlled, onOpenChange]
  )

  // A disabled tooltip must forget any prior hover/focus-open state. Without
  // this reset, re-enabling it can resurrect stale content immediately.
  React.useEffect(() => {
    if (disabled) {
      setUncontrolledOpen(false)
    }
  }, [disabled])

  React.useEffect(() => {
    const closeTooltip = () => handleOpenChange(false)
    const dismissTooltipUntilInteraction = () => {
      // Returning to a tab can restore hover/focus on the old trigger and make
      // Radix request an immediate reopen. Keep it blocked until the user
      // provides fresh pointer or keyboard intent.
      blockPointerOpenRef.current = true
      closeTooltip()
    }
    // Run on both hidden and visible transitions. The visible transition is
    // important because browsers may restore trigger focus/hover as the tab is
    // activated, even if the corresponding blur event was skipped.
    const dismissVisibilityTooltip = () => dismissTooltipUntilInteraction()
    const dismissPointerTooltip = () => {
      blockPointerOpenRef.current = true
      closeTooltip()
    }
    const allowTooltipOpen = () => {
      blockPointerOpenRef.current = false
    }

    window.addEventListener('blur', dismissTooltipUntilInteraction)
    window.addEventListener('focus', dismissTooltipUntilInteraction)
    window.addEventListener('pagehide', dismissTooltipUntilInteraction)
    document.addEventListener('visibilitychange', dismissVisibilityTooltip)
    document.addEventListener('pointerdown', dismissPointerTooltip, true)
    document.addEventListener('pointermove', allowTooltipOpen, true)
    document.addEventListener('keydown', allowTooltipOpen, true)

    return () => {
      window.removeEventListener('blur', dismissTooltipUntilInteraction)
      window.removeEventListener('focus', dismissTooltipUntilInteraction)
      window.removeEventListener('pagehide', dismissTooltipUntilInteraction)
      document.removeEventListener('visibilitychange', dismissVisibilityTooltip)
      document.removeEventListener('pointerdown', dismissPointerTooltip, true)
      document.removeEventListener('pointermove', allowTooltipOpen, true)
      document.removeEventListener('keydown', allowTooltipOpen, true)
    }
  }, [handleOpenChange])

  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={handleOpenChange}
      {...props}
    />
  )
}
Tooltip.displayName = TooltipPrimitive.Root.displayName

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 5, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[100] overflow-visible rounded-md bg-[var(--surface)] px-3 py-1.5 text-xs font-mono text-[var(--text)] shadow-elevation drop-shadow-[0_0_0.5px_var(--border)]',
        'data-[state=closed]:animate-[fadeOut_120ms_ease-in] data-[state=delayed-open]:animate-[fadeIn_150ms_ease-out]',
        className
      )}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow
        className="fill-[var(--surface)]"
        width={11}
        height={5}
      />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent }
