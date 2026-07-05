"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const TooltipTrigger = TooltipPrimitive.Trigger

const Tooltip = ({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const blockPointerOpenRef = React.useRef(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
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
    [isControlled, onOpenChange]
  )

  React.useEffect(() => {
    const closeTooltip = () => handleOpenChange(false)
    const closeHiddenTooltip = () => {
      if (document.visibilityState === 'hidden') {
        closeTooltip()
      }
    }
    const dismissPointerTooltip = () => {
      blockPointerOpenRef.current = true
      closeTooltip()
    }
    const allowTooltipOpen = () => {
      blockPointerOpenRef.current = false
    }

    window.addEventListener('blur', closeTooltip)
    window.addEventListener('pagehide', closeTooltip)
    document.addEventListener('visibilitychange', closeHiddenTooltip)
    document.addEventListener('pointerdown', dismissPointerTooltip, true)
    document.addEventListener('pointermove', allowTooltipOpen, true)
    document.addEventListener('keydown', allowTooltipOpen, true)

    return () => {
      window.removeEventListener('blur', closeTooltip)
      window.removeEventListener('pagehide', closeTooltip)
      document.removeEventListener('visibilitychange', closeHiddenTooltip)
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
