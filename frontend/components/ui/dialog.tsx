"use client"

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, overlayClassName, ...props }, ref) => (
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
      ref={ref}
      className={cn(
        'fixed left-1/2 top-[20vh] z-[100] w-[500px] max-w-[90vw] -translate-x-1/2 rounded-xl border border-border [background:color-mix(in_oklab,var(--surface)_45%,transparent)] text-ink shadow-2xl backdrop-blur-md dark:text-paper',
        'data-[state=closed]:animate-[fadeOut_150ms_ease-in] data-[state=open]:animate-[scaleIn_180ms_ease-out]',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
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

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
