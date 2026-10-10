"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string
  /**
   * Focus the dialog itself on open rather than its first control. Use it when
   * that control is an icon button: focus would open its tooltip by itself,
   * and the first Escape would close the tooltip instead of the dialog.
   */
  focusSelfOnOpen?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, overlayClassName, focusSelfOnOpen = false, onOpenAutoFocus, ...props }, ref) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }, [ref])

  return (
  <DialogPortal>
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[100] bg-scrim backdrop-blur-xs',
        'data-[state=closed]:animate-[fadeOut_150ms_ease-in] data-[state=open]:animate-[fadeIn_150ms_ease-out]',
        overlayClassName
      )}
    />
    <DialogPrimitive.Content
      ref={setRefs}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        if (focusSelfOnOpen && !event.defaultPrevented) {
          event.preventDefault()
          contentRef.current?.focus()
        }
      }}
      className={cn(
        'fixed left-1/2 top-[20vh] z-[100] w-[500px] max-w-[90vw] -translate-x-1/2 rounded-xl border border-border [background:color-mix(in_oklab,var(--surface)_45%,transparent)] text-ink shadow-2xl backdrop-blur-md dark:text-paper',
        'data-[state=closed]:animate-[fadeOut_150ms_ease-in] data-[state=open]:animate-[scaleIn_180ms_ease-out]',
        focusSelfOnOpen && 'focus:outline-none',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-serif text-xl italic text-ink dark:text-paper', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

/**
 * The dialog's close button: an X that says Close in its tooltip. It closes
 * through the dialog's onOpenChange, so whatever guards closing there (an
 * upload in progress, say) applies here too.
 */
const DialogCloseButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<typeof IconButton>, 'label' | 'icon'>
>((props, ref) => (
  <DialogPrimitive.Close asChild>
    <IconButton ref={ref} label="Close" icon={<X className="h-4 w-4" aria-hidden="true" />} {...props} />
  </DialogPrimitive.Close>
))
DialogCloseButton.displayName = 'DialogCloseButton'

export {
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
