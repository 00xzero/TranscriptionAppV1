"use client"

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  description: string
  descriptionLive?: boolean
  onConfirm: () => void | Promise<void>
  title?: string
  heading?: string
  cancelLabel?: string
  confirmLabel?: string
  pendingLabel?: string
  confirmDisabled?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  description,
  descriptionLive = false,
  onConfirm,
  title = 'Confirm action',
  heading,
  cancelLabel = 'Cancel',
  confirmLabel = 'OK',
  pendingLabel,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return
    if (!nextOpen) setError(null)
    onOpenChange(nextOpen)
  }

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="overflow-hidden p-0">
        <div className="px-6 pt-6 pb-5">
          {heading ? (
            <AlertDialogTitle className="mb-2 font-sans text-sm font-semibold not-italic text-ink dark:text-paper">
              {heading}
            </AlertDialogTitle>
          ) : (
            <AlertDialogTitle className="sr-only">{title}</AlertDialogTitle>
          )}
          <AlertDialogDescription
            aria-live={descriptionLive ? 'polite' : undefined}
            className="text-sm leading-relaxed text-ink/80 dark:text-paper/80"
          >
            {description}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-sm text-ember-red">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending || confirmDisabled} onClick={handleConfirm}>
            {pending ? pendingLabel ?? confirmLabel : confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
