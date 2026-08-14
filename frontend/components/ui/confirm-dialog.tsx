"use client"

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
  onConfirm: () => void | Promise<void>
  title?: string
  heading?: string
  cancelLabel?: string
  confirmLabel?: string
}

export function ConfirmDialog({
  open,
  onOpenChange,
  description,
  onConfirm,
  title = 'Confirm action',
  heading,
  cancelLabel = 'Cancel',
  confirmLabel = 'OK',
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="overflow-hidden p-0">
        <div className="px-6 pt-6 pb-5">
          {heading ? (
            <AlertDialogTitle className="mb-2 font-sans text-sm font-semibold not-italic text-ink dark:text-paper">
              {heading}
            </AlertDialogTitle>
          ) : (
            <AlertDialogTitle className="sr-only">{title}</AlertDialogTitle>
          )}
          <AlertDialogDescription className="text-sm leading-relaxed text-ink/80 dark:text-paper/80">
            {description}
          </AlertDialogDescription>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
